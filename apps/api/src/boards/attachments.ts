import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { loadMembership, canViewBoard, canEditBoard } from './auth.js';
import { logActivity } from './activity.js';
import { emitBoardEvent, actorSocketId } from '../realtime.js';
import { optimizeImageInPlace } from '../lib/optimize.js';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

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

    const ext = path.extname(file.filename || '').slice(0, 12);
    const key = `${crypto.randomBytes(12).toString('hex')}${ext}`;
    const cardDir = path.join(UPLOAD_ROOT, card.id);
    await ensureDir(cardDir);
    const dest = path.join(cardDir, key);

    let totalBytes = 0;
    const fh = await fs.open(dest, 'w');
    try {
      for await (const chunk of file.file) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          await fh.close();
          await fs.unlink(dest).catch(() => {});
          return reply.code(413).send({ error: 'too_large', message: 'File exceeds 10 MB' });
        }
        await fh.write(chunk);
      }
    } finally {
      await fh.close();
    }

    if (file.file.truncated) {
      await fs.unlink(dest).catch(() => {});
      return reply.code(413).send({ error: 'too_large', message: 'File exceeds 10 MB' });
    }

    // Shrink + re-encode photos to WebP — saves ~70% bandwidth.
    let storedMime = file.mimetype || 'application/octet-stream';
    let storedSize = totalBytes;
    let storedName = file.filename || key;
    try {
      const opt = await optimizeImageInPlace(dest, storedMime);
      if (opt) {
        storedMime = opt.mimeType;
        storedSize = opt.sizeBytes;
        storedName = opt.filename(storedName);
      }
    } catch (err) {
      request.log.warn({ err }, 'image optimization failed, keeping original');
    }

    const att = await prisma.attachment.create({
      data: {
        cardId: card.id,
        uploadedById: request.userId!,
        filename: storedName,
        mimeType: storedMime,
        sizeBytes: storedSize,
        s3Key: `${card.id}/${key}`,
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

    const fp = path.join(UPLOAD_ROOT, att.s3Key);
    try {
      await fs.access(fp);
    } catch {
      return reply.code(404).send({ error: 'file_missing', message: 'File no longer on disk' });
    }
    return reply
      .header('content-type', att.mimeType)
      .header('content-disposition', `inline; filename="${encodeURIComponent(att.filename)}"`)
      .send(await fs.readFile(fp));
  });

  // Rename attachment (just changes the display filename, file on disk stays)
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
    await fs.unlink(path.join(UPLOAD_ROOT, att.s3Key)).catch(() => {});
    emitBoardEvent(att.card.list.boardId, 'card:detail_changed', { cardId: att.cardId, kind: 'attachment_removed' }, actorSocketId(request));
    return reply.code(204).send();
  });
}
