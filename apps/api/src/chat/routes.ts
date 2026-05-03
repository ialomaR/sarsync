import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { emitDeptEvent, actorSocketId } from '../realtime.js';
import { notify } from '../notifications/service.js';
import { optimizeImageInPlace } from '../lib/optimize.js';

// Markup convention: @[Display Name](userId)
// Only IDs are trusted on the server; the display name is just for rendering.
const MENTION_RE = /@\[([^\]]+)\]\(([a-z0-9_-]+)\)/gi;
function extractMentions(body: string): string[] {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(body)) !== null) ids.add(m[2]);
  return [...ids];
}

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'chat');
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB — same as media library
// 2 minutes — short enough that the chat reads as an audit trail, long
// enough to fix typos. Applies to both edits and self-deletes. Department
// managers + admins can still delete after the window closes (moderation).
const AUTHOR_MUTATION_WINDOW_MS = 2 * 60 * 1000;

const BLOCKED_EXTS = new Set([
  '.exe', '.bat', '.cmd', '.scr', '.vbs', '.ps1', '.msi', '.app', '.dmg',
  '.com', '.pif', '.jar', '.sh',
]);

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

// Same visibility rule as media: dept members + admins. Returns membership
// or null. Cross-dept board grants do NOT confer chat access.
async function deptMembership(userId: string, departmentId: string) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) return null;
  const ms = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: dept.workspaceId } },
  });
  if (!ms) return null;
  if (ms.role === Role.admin) return { ms, dept };
  if (ms.role === Role.guest) return null;
  if (ms.departmentId === departmentId) return { ms, dept };
  return null;
}

function serializeMessage(msg: {
  id: string; departmentId: string; authorId: string; body: string; kind: string;
  attachmentId: string | null; createdAt: Date; editedAt: Date | null; deletedAt: Date | null;
  author: { id: string; firstName: string; lastName: string; avatarColor: string };
  attachment: {
    id: string; filename: string; mimeType: string; sizeBytes: number;
    durationMs: number | null; thumbS3Key: string | null;
  } | null;
}) {
  return {
    id: msg.id,
    departmentId: msg.departmentId,
    authorId: msg.authorId,
    author: {
      id: msg.author.id,
      name: `${msg.author.firstName} ${msg.author.lastName}`.trim(),
      avatarColor: msg.author.avatarColor,
    },
    body: msg.deletedAt ? '' : msg.body,
    kind: msg.kind,
    deleted: !!msg.deletedAt,
    createdAt: msg.createdAt.toISOString(),
    editedAt: msg.editedAt ? msg.editedAt.toISOString() : null,
    attachment: msg.attachment ? {
      id: msg.attachment.id,
      filename: msg.attachment.filename,
      mimeType: msg.attachment.mimeType,
      sizeBytes: msg.attachment.sizeBytes,
      durationMs: msg.attachment.durationMs,
      isImage: IMAGE_MIMES.has(msg.attachment.mimeType),
      url: `/api/chat/attachments/${msg.attachment.id}/file`,
      thumbUrl: msg.attachment.thumbS3Key ? `/api/chat/attachments/${msg.attachment.id}/thumb` : null,
    } : null,
  };
}

export async function chatRoutes(app: FastifyInstance) {
  // Standard Bearer auth for JSON endpoints. Attachment file/thumb GETs use
  // their own preHandler (token query param) since browsers can't set
  // Authorization on <img>.
  app.addHook('preHandler', async (request, reply) => {
    // Allow attachment GETs to fall through to their custom auth.
    if (request.url.startsWith('/api/chat/attachments/') || request.url.startsWith('/chat/attachments/')) return;
    return requireAuth(request, reply);
  });

  // ── List messages ────────────────────────────────────────────────────────

  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
    '/departments/:id/chat/messages', async (request, reply) => {
      const v = await deptMembership(request.userId!, request.params.id);
      if (!v) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

      const limit = Math.min(parseInt(request.query.limit || '50', 10), 100);
      const before = request.query.before ? new Date(request.query.before) : null;

      const rows = await prisma.chatMessage.findMany({
        where: {
          departmentId: request.params.id,
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        include: {
          author: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
          attachment: true,
        },
      });
      const hasMore = rows.length > limit;
      const slice = rows.slice(0, limit);

      // Return chronological (oldest first) so the UI can append at bottom.
      slice.reverse();
      return reply.send({
        messages: slice.map(serializeMessage),
        hasMore,
      });
    });

  // ── Post a text message ─────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { body?: string; attachmentId?: string | null } }>(
    '/departments/:id/chat/messages', async (request, reply) => {
      const v = await deptMembership(request.userId!, request.params.id);
      if (!v) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

      const body = (request.body?.body || '').trim();
      const attachmentId = request.body?.attachmentId || null;
      if (!body && !attachmentId) {
        return reply.code(400).send({ error: 'empty', message: 'Message must have body or attachment' });
      }
      if (body.length > 10_000) {
        return reply.code(400).send({ error: 'too_long', message: 'Message too long (max 10k chars)' });
      }

      // If the attachmentId is supplied, validate it is unowned.
      if (attachmentId) {
        const att = await prisma.chatAttachment.findUnique({
          where: { id: attachmentId },
          include: { message: { select: { id: true } } },
        });
        if (!att || att.message) {
          return reply.code(400).send({ error: 'invalid_attachment', message: 'Attachment not available' });
        }
      }

      let kind = 'text';
      if (attachmentId) {
        const att = await prisma.chatAttachment.findUnique({ where: { id: attachmentId } });
        if (att) {
          if (IMAGE_MIMES.has(att.mimeType)) kind = 'image';
          else if (att.durationMs) kind = 'voice';
          else kind = 'file';
        }
      }

      const created = await prisma.chatMessage.create({
        data: {
          departmentId: request.params.id,
          authorId: request.userId!,
          body, kind, attachmentId,
        },
        include: {
          author: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
          attachment: true,
        },
      });

      const payload = serializeMessage(created);
      emitDeptEvent(request.params.id, 'chat:message_added', payload, actorSocketId(request));

      // @mentions → notifications. Only mentions that resolve to real dept
      // members are notified — silently drops bogus IDs, outsiders, and the
      // actor themselves (you can't @mention yourself).
      const mentionIds = extractMentions(body).filter((id) => id !== request.userId);
      if (mentionIds.length > 0) {
        const validMentions = await prisma.membership.findMany({
          where: {
            userId: { in: mentionIds },
            workspaceId: v.dept.workspaceId,
            OR: [
              { departmentId: request.params.id },
              { role: 'admin' },
            ],
          },
          select: { userId: true },
        });
        const snippet = body.replace(MENTION_RE, '@$1').slice(0, 140);
        await Promise.all(validMentions.map((vm) => notify({
          recipientId: vm.userId,
          actorId: request.userId!,
          workspaceId: v.dept.workspaceId,
          kind: 'chat_mention',
          title: `mentioned you in ${v.dept.name}`,
          body: snippet,
          link: `/dept/${request.params.id}?tab=chat`,
          meta: { departmentId: request.params.id, messageId: created.id },
        })));
      }

      return reply.code(201).send(payload);
    });

  // ── Edit (author only, within edit window) ──────────────────────────────

  app.patch<{ Params: { id: string }; Body: { body?: string } }>(
    '/chat/messages/:id', async (request, reply) => {
      const msg = await prisma.chatMessage.findUnique({ where: { id: request.params.id } });
      if (!msg) return reply.code(404).send({ error: 'not_found', message: 'Message not found' });
      if (msg.deletedAt) return reply.code(410).send({ error: 'deleted', message: 'Message is deleted' });
      if (msg.authorId !== request.userId) return reply.code(403).send({ error: 'forbidden', message: 'Not your message' });
      if (Date.now() - msg.createdAt.getTime() > AUTHOR_MUTATION_WINDOW_MS) {
        return reply.code(410).send({ error: 'edit_window_closed', message: 'Edit window has closed (2 min)' });
      }

      const body = (request.body?.body || '').trim();
      if (!body) return reply.code(400).send({ error: 'empty', message: 'Body cannot be empty' });
      if (body.length > 10_000) return reply.code(400).send({ error: 'too_long', message: 'Too long' });

      const updated = await prisma.chatMessage.update({
        where: { id: msg.id },
        data: { body, editedAt: new Date() },
        include: {
          author: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
          attachment: true,
        },
      });
      const payload = serializeMessage(updated);
      emitDeptEvent(msg.departmentId, 'chat:message_edited', payload, actorSocketId(request));
      return reply.send(payload);
    });

  // ── Delete (author or dept_manager / admin) ─────────────────────────────

  app.delete<{ Params: { id: string } }>('/chat/messages/:id', async (request, reply) => {
    const msg = await prisma.chatMessage.findUnique({ where: { id: request.params.id } });
    if (!msg) return reply.code(404).send({ error: 'not_found', message: 'Message not found' });
    const v = await deptMembership(request.userId!, msg.departmentId);
    if (!v) return reply.code(403).send({ error: 'forbidden', message: 'No access' });
    const isAuthor = msg.authorId === request.userId;
    const isManager = v.ms.role === Role.admin || v.ms.role === Role.dept_manager;
    if (!isAuthor && !isManager) return reply.code(403).send({ error: 'forbidden', message: 'Cannot delete' });
    // Authors can only delete within the 2-minute window; managers retain
    // moderation rights afterwards. The chat becomes a stable record once
    // older messages can no longer be removed by their writer.
    if (isAuthor && !isManager
        && Date.now() - msg.createdAt.getTime() > AUTHOR_MUTATION_WINDOW_MS) {
      return reply.code(410).send({
        error: 'delete_window_closed',
        message: 'Delete window has closed (2 min)',
      });
    }

    await prisma.chatMessage.update({
      where: { id: msg.id },
      data: { deletedAt: new Date() },
    });
    emitDeptEvent(msg.departmentId, 'chat:message_deleted', { id: msg.id, departmentId: msg.departmentId }, actorSocketId(request));
    return reply.code(204).send();
  });

  // ── Mark chat as read ────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/departments/:id/chat/read', async (request, reply) => {
    const v = await deptMembership(request.userId!, request.params.id);
    if (!v) return reply.code(403).send({ error: 'forbidden', message: 'No access' });
    await prisma.chatRead.upsert({
      where: { departmentId_userId: { departmentId: request.params.id, userId: request.userId! } },
      create: { departmentId: request.params.id, userId: request.userId!, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
    return reply.code(204).send();
  });

  // ── Per-dept unread counts for the sidebar ───────────────────────────────
  // Returns { [deptId]: count } for every dept the user has chat access to.

  app.get('/me/chat-unread', async (request, reply) => {
    const userId = request.userId!;
    const memberships = await prisma.membership.findMany({
      where: { userId },
      select: { workspaceId: true, role: true, departmentId: true },
    });
    if (memberships.length === 0) return reply.send({ counts: {} });

    // Collect dept ids the user can see chat in: own dept (any role except guest)
    // + all depts in workspaces where the user is admin.
    const ownDeptIds = memberships
      .filter((m) => m.role !== 'guest' && m.departmentId)
      .map((m) => m.departmentId as string);
    const adminWsIds = memberships.filter((m) => m.role === 'admin').map((m) => m.workspaceId);
    const adminDepts = adminWsIds.length === 0 ? [] : await prisma.department.findMany({
      where: { workspaceId: { in: adminWsIds } },
      select: { id: true },
    });
    const deptIds = [...new Set([...ownDeptIds, ...adminDepts.map((d) => d.id)])];
    if (deptIds.length === 0) return reply.send({ counts: {} });

    const reads = await prisma.chatRead.findMany({
      where: { userId, departmentId: { in: deptIds } },
      select: { departmentId: true, lastReadAt: true },
    });
    const readByDept = new Map(reads.map((r) => [r.departmentId, r.lastReadAt]));

    const counts: Record<string, number> = {};
    await Promise.all(deptIds.map(async (deptId) => {
      const since = readByDept.get(deptId) ?? new Date(0);
      const c = await prisma.chatMessage.count({
        where: {
          departmentId: deptId,
          createdAt: { gt: since },
          authorId: { not: userId }, // your own messages don't count as unread
          deletedAt: null,
        },
      });
      if (c > 0) counts[deptId] = c;
    }));
    return reply.send({ counts });
  });

  // ── Typing indicator (best-effort, not persisted) ───────────────────────

  app.post<{ Params: { id: string } }>('/departments/:id/chat/typing', async (request, reply) => {
    const v = await deptMembership(request.userId!, request.params.id);
    if (!v) return reply.code(403).send({ error: 'forbidden', message: 'No access' });
    emitDeptEvent(request.params.id, 'chat:typing', {
      userId: request.userId!,
      name: `${(await prisma.user.findUnique({ where: { id: request.userId! } }))?.firstName || ''}`,
      at: Date.now(),
    }, actorSocketId(request));
    return reply.code(204).send();
  });

  // ── Attachment upload (multipart) ───────────────────────────────────────
  // Returns an unowned ChatAttachment id. The client then sends a message
  // referencing it. This two-step pattern decouples the upload progress UI
  // from the lightweight message POST.

  app.post<{ Params: { id: string } }>('/departments/:id/chat/upload', async (request, reply) => {
    const v = await deptMembership(request.userId!, request.params.id);
    if (!v) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'No file' });

    const ext = path.extname(file.filename || '').toLowerCase();
    if (BLOCKED_EXTS.has(ext)) {
      return reply.code(415).send({ error: 'blocked_type', message: 'This file type is not allowed' });
    }

    const key = `${crypto.randomBytes(12).toString('hex')}${ext}`;
    const deptDir = path.join(UPLOAD_ROOT, request.params.id);
    await ensureDir(deptDir);
    const dest = path.join(deptDir, key);

    let totalBytes = 0;
    const fh = await fs.open(dest, 'w');
    try {
      for await (const chunk of file.file) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          await fh.close();
          await fs.unlink(dest).catch(() => {});
          return reply.code(413).send({ error: 'too_large', message: 'File exceeds 100 MB' });
        }
        await fh.write(chunk);
      }
    } finally {
      await fh.close();
    }
    if (file.file.truncated) {
      await fs.unlink(dest).catch(() => {});
      return reply.code(413).send({ error: 'too_large', message: 'File exceeds 100 MB' });
    }

    // Shrink + re-encode photos to WebP before deriving the thumbnail.
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
      request.log.warn({ err }, 'chat image optimization failed, keeping original');
    }

    let thumbKey: string | null = null;
    if (IMAGE_MIMES.has(storedMime)) {
      const thumbName = `${path.basename(key, ext)}_thumb.webp`;
      const thumbDest = path.join(deptDir, thumbName);
      try {
        await sharp(dest)
          .rotate()
          .resize({ width: 480, height: 480, fit: 'inside' })
          .webp({ quality: 78 })
          .toFile(thumbDest);
        thumbKey = `${request.params.id}/${thumbName}`;
      } catch (err) {
        request.log.warn({ err }, 'chat thumb generation failed');
      }
    }

    // Voice messages: client reports duration in X-Duration-Ms header.
    // We trust it for display only — the file content is the source of truth.
    const rawDur = request.headers['x-duration-ms'];
    const durationMs = typeof rawDur === 'string' ? parseInt(rawDur, 10) : NaN;

    const att = await prisma.chatAttachment.create({
      data: {
        filename: storedName,
        mimeType: storedMime,
        sizeBytes: storedSize,
        s3Key: `${request.params.id}/${key}`,
        thumbS3Key: thumbKey,
        durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
      },
    });
    return reply.code(201).send({
      id: att.id, filename: att.filename, mimeType: att.mimeType,
      sizeBytes: att.sizeBytes, isImage: IMAGE_MIMES.has(att.mimeType),
      durationMs: att.durationMs,
      url: `/api/chat/attachments/${att.id}/file`,
      thumbUrl: att.thumbS3Key ? `/api/chat/attachments/${att.id}/thumb` : null,
    });
  });

  // ── Attachment file + thumb (custom auth: bearer OR ?token=) ───────────

  app.register(async (instance) => {
    instance.addHook('preHandler', async (request, reply) => {
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
        return reply.code(401).send({ error: 'unauthorized', message: 'Invalid token' });
      }
    });

    instance.get<{ Params: { id: string } }>('/chat/attachments/:id/file', async (request, reply) => {
      const att = await prisma.chatAttachment.findUnique({
        where: { id: request.params.id },
        include: { message: { select: { departmentId: true } } },
      });
      if (!att) return reply.code(404).send({ error: 'not_found', message: 'Not found' });
      // If the attachment is owned by a message, verify the viewer can see it.
      if (att.message) {
        const v = await deptMembership(request.userId!, att.message.departmentId);
        if (!v) return reply.code(403).send({ error: 'forbidden', message: 'No access' });
      }
      const fp = path.join(UPLOAD_ROOT, att.s3Key);
      try { await fs.access(fp); } catch {
        return reply.code(404).send({ error: 'file_missing', message: 'File no longer on disk' });
      }
      return reply
        .header('content-type', att.mimeType)
        .header('content-disposition', `inline; filename="${encodeURIComponent(att.filename)}"`)
        .send(await fs.readFile(fp));
    });

    instance.get<{ Params: { id: string } }>('/chat/attachments/:id/thumb', async (request, reply) => {
      const att = await prisma.chatAttachment.findUnique({
        where: { id: request.params.id },
        include: { message: { select: { departmentId: true } } },
      });
      if (!att || !att.thumbS3Key) return reply.code(404).send({ error: 'not_found', message: 'No thumb' });
      if (att.message) {
        const v = await deptMembership(request.userId!, att.message.departmentId);
        if (!v) return reply.code(403).send({ error: 'forbidden', message: 'No access' });
      }
      const fp = path.join(UPLOAD_ROOT, att.thumbS3Key);
      try { await fs.access(fp); } catch {
        return reply.code(404).send({ error: 'file_missing', message: 'Thumb no longer on disk' });
      }
      return reply
        .header('content-type', 'image/webp')
        .header('cache-control', 'private, max-age=86400')
        .send(await fs.readFile(fp));
    });
  });
}
