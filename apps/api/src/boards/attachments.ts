import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { loadMembership, canViewBoard, canEditBoard } from './auth.js';
import { logActivity } from './activity.js';
import { emitBoardEvent, actorSocketId } from '../realtime.js';
import { optimizeImageBuffer } from '../lib/optimize.js';
import { putObject, getObjectBuffer, deleteObject, copyObject } from '../lib/storage.js';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — leaves room for short videos

export async function attachmentRoutes(app: FastifyInstance) {
  // Custom auth: standard Bearer header OR ?token= query param.
  // The token query param is needed for <img src=...> tags which can't set
  // Authorization headers. Token leaks in URL/referrer — acceptable for local dev;
  // for prod we should switch to signed/short-lived URLs.
  app.addHook('preHandler', async (request, reply) => {
    const header = request.headers.authorization;
    const queryToken = (request.query as { token?: string })?.token;
    let token: string | undefined;
    if (header?.startsWith('Bearer ')) token = header.slice(7);
    else if (queryToken) token = queryToken;
    if (!token) return reply.code(401).send({ error: 'unauthorized', message: 'Missing token' });
    try {
      const payload = verifyAccessToken(token);
      request.userId = payload.sub;
    } catch {
      return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired token' });
    }
  });

  // Upload attachment to a card
  app.post<{ Params: { id: string } }>('/cards/:id/attachments', async (request, reply) => {
    const card = await prisma.card.findUnique({
      where: { id: request.params.id },
      include: { list: { include: { board: true } } },
    });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'No file uploaded' });

    // Buffer the upload (with size cap) so we can both optimize it and
    // hand it to S3 / local disk uniformly.
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of file.file) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        return reply.code(413).send({ error: 'too_large', message: 'File exceeds 50 MB' });
      }
      chunks.push(chunk);
    }
    if (file.file.truncated) {
      return reply.code(413).send({ error: 'too_large', message: 'File exceeds 50 MB' });
    }
    let buffer: Buffer = Buffer.concat(chunks) as Buffer;

    // Shrink + re-encode photos to WebP — saves ~70% bandwidth.
    let storedMime = file.mimetype || 'application/octet-stream';
    let storedName = file.filename || 'file';
    try {
      const opt = await optimizeImageBuffer(buffer, storedMime);
      if (opt) {
        buffer = opt.buffer;
        storedMime = opt.mimeType;
        storedName = opt.filename(storedName);
      }
    } catch (err) {
      request.log.warn({ err }, 'image optimization failed, keeping original');
    }

    const ext = path.extname(storedName).slice(0, 12) || '';
    const key = `cards/${card.id}/${crypto.randomBytes(12).toString('hex')}${ext}`;
    await putObject(key, buffer, storedMime);

    const att = await prisma.attachment.create({
      data: {
        cardId: card.id,
        uploadedById: request.userId!,
        filename: storedName,
        mimeType: storedMime,
        sizeBytes: buffer.length,
        s3Key: key,
      },
    });
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'card_described', targetType: 'card', targetId: card.id,
      meta: { cardTitle: card.title, attachment: att.filename },
    });
    emitBoardEvent(card.list.boardId, 'card:detail_changed', { cardId: card.id, kind: 'attachment_added' }, actorSocketId(request));
    return reply.code(201).send({
      id: att.id, filename: att.filename, mimeType: att.mimeType,
      sizeBytes: att.sizeBytes, createdAt: att.createdAt.toISOString(),
      url: `/api/attachments/${att.id}`,
    });
  });

  // Attach an existing media-library item to a card. Copies the file under
  // a card-scoped key so the attachment is independent (deleting the card
  // attachment doesn't touch the media library, and vice versa).
  app.post<{ Params: { id: string }; Body: { mediaId?: string } }>(
    '/cards/:id/attachments/from-media',
    async (request, reply) => {
      const card = await prisma.card.findUnique({
        where: { id: request.params.id },
        include: { list: { include: { board: true } } },
      });
      if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
      await loadMembership(request, reply, card.list.board.workspaceId);
      if (reply.sent) return;
      if (!canEditBoard(request.membership!, card.list.board)) {
        return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });
      }

      const mediaId = request.body?.mediaId;
      if (!mediaId) return reply.code(400).send({ error: 'no_media', message: 'mediaId required' });

      const media = await prisma.mediaItem.findUnique({ where: { id: mediaId } });
      if (!media) return reply.code(404).send({ error: 'not_found', message: 'Media item not found' });

      // Visibility: the user must have access to the department the media
      // lives in. We piggyback on workspace membership + dept access rules.
      const m = request.membership!;
      const sameWorkspace = await prisma.department.findUnique({
        where: { id: media.departmentId },
        select: { workspaceId: true },
      });
      if (!sameWorkspace || sameWorkspace.workspaceId !== m.workspaceId) {
        return reply.code(403).send({ error: 'forbidden', message: 'Media not in your workspace' });
      }
      if (m.role !== 'admin' && m.departmentId && m.departmentId !== media.departmentId) {
        return reply.code(403).send({ error: 'forbidden', message: 'Media belongs to another department' });
      }

      const ext = path.extname(media.filename).slice(0, 12) || '';
      const destKey = `cards/${card.id}/${crypto.randomBytes(12).toString('hex')}${ext}`;
      const copied = await copyObject(media.s3Key, destKey);
      if (!copied) {
        return reply.code(500).send({ error: 'copy_failed', message: 'Could not copy media file' });
      }

      const att = await prisma.attachment.create({
        data: {
          cardId: card.id,
          uploadedById: request.userId!,
          filename: media.filename,
          mimeType: media.mimeType,
          sizeBytes: media.sizeBytes,
          s3Key: destKey,
        },
      });
      await logActivity({
        boardId: card.list.boardId, actorId: request.userId!,
        verb: 'card_described', targetType: 'card', targetId: card.id,
        meta: { cardTitle: card.title, attachment: att.filename, fromMedia: true },
      });
      emitBoardEvent(card.list.boardId, 'card:detail_changed', { cardId: card.id, kind: 'attachment_added' }, actorSocketId(request));
      return reply.code(201).send({
        id: att.id, filename: att.filename, mimeType: att.mimeType,
        sizeBytes: att.sizeBytes, createdAt: att.createdAt.toISOString(),
        url: `/api/attachments/${att.id}`,
      });
    },
  );

  // Download attachment (auth + visibility)
  app.get<{ Params: { id: string } }>('/attachments/:id', async (request, reply) => {
    const att = await prisma.attachment.findUnique({
      where: { id: request.params.id },
      include: { card: { include: { list: { include: { board: true } } } } },
    });
    if (!att) return reply.code(404).send({ error: 'not_found', message: 'Attachment not found' });
    await loadMembership(request, reply, att.card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canViewBoard(request.membership!, att.card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const buffer = await getObjectBuffer(att.s3Key);
    if (!buffer) return reply.code(404).send({ error: 'file_missing', message: 'File no longer in storage' });

    return reply
      .header('content-type', att.mimeType)
      .header('content-disposition', `inline; filename="${encodeURIComponent(att.filename)}"`)
      .send(buffer);
  });

  // Rename attachment (just changes the display filename, file in storage stays)
  app.patch<{ Params: { id: string }; Body: { filename?: string } }>('/attachments/:id', async (request, reply) => {
    const att = await prisma.attachment.findUnique({
      where: { id: request.params.id },
      include: { card: { include: { list: { include: { board: true } } } } },
    });
    if (!att) return reply.code(404).send({ error: 'not_found', message: 'Attachment not found' });
    await loadMembership(request, reply, att.card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, att.card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const filename = (request.body?.filename || '').trim();
    if (!filename || filename.length > 255) {
      return reply.code(400).send({ error: 'invalid_filename', message: 'Filename must be 1-255 chars' });
    }
    const updated = await prisma.attachment.update({
      where: { id: att.id },
      data: { filename },
    });
    emitBoardEvent(att.card.list.boardId, 'card:detail_changed', { cardId: att.cardId, kind: 'attachment_renamed' }, actorSocketId(request));
    return reply.send({
      id: updated.id, filename: updated.filename, mimeType: updated.mimeType,
      sizeBytes: updated.sizeBytes, createdAt: updated.createdAt.toISOString(),
      url: `/api/attachments/${updated.id}`,
    });
  });

  // Delete attachment
  app.delete<{ Params: { id: string } }>('/attachments/:id', async (request, reply) => {
    const att = await prisma.attachment.findUnique({
      where: { id: request.params.id },
      include: { card: { include: { list: { include: { board: true } } } } },
    });
    if (!att) return reply.code(404).send({ error: 'not_found', message: 'Attachment not found' });
    await loadMembership(request, reply, att.card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, att.card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    await prisma.attachment.delete({ where: { id: att.id } });
    await deleteObject(att.s3Key);
    emitBoardEvent(att.card.list.boardId, 'card:detail_changed', { cardId: att.cardId, kind: 'attachment_removed' }, actorSocketId(request));
    return reply.code(204).send();
  });
}
