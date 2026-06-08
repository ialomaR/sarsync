import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import crypto from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { optimizeImageBuffer, generateThumbBuffer } from '../lib/optimize.js';
import { putObject, getObjectBuffer, deleteObject } from '../lib/storage.js';
import { safeDownloadHeaders } from '../lib/download.js';
import { parseDateParam } from '../lib/dates.js';

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB — global standard for collaboration tools

// Block executable / system file types regardless of mime sniff. Same blocklist
// as Slack/Asana/Linear default deny.
const BLOCKED_EXTS = new Set([
  '.exe', '.bat', '.cmd', '.scr', '.vbs', '.ps1', '.msi', '.app', '.dmg',
  '.com', '.pif', '.jar', '.sh',
  // Active web content (defense in depth; downloads are already forced to
  // attachment via lib/download.ts).
  '.html', '.htm', '.xhtml', '.shtml', '.svg', '.xml',
]);

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

// Visibility: members of the department, dept_manager (head) of that dept,
// or workspace admins. Returns the membership row or null.
async function deptViewerMembership(userId: string, departmentId: string) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) return { allowed: false as const, dept: null };
  const ms = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: dept.workspaceId } },
  });
  if (!ms) return { allowed: false as const, dept };
  if (ms.role === Role.admin) return { allowed: true as const, dept, ms };
  if (ms.role === Role.guest) return { allowed: false as const, dept };
  if (ms.departmentId === departmentId) return { allowed: true as const, dept, ms };
  return { allowed: false as const, dept };
}

export async function mediaRoutes(app: FastifyInstance) {
  // Custom auth: Bearer header OR ?token= for inline <img src> + downloads.
  // Same pattern as attachments.ts.
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

  // List media items for a department (newest first, paginated).
  // Optional `?source=upload|chat` filter for the "Chat files" tab.
  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string; source?: string } }>('/departments/:id/media', async (request, reply) => {
    const v = await deptViewerMembership(request.userId!, request.params.id);
    if (!v.allowed) return reply.code(403).send({ error: 'forbidden', message: 'No access to this department' });

    const parsedLimit = parseInt(request.query.limit || '60', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 60;
    const before = parseDateParam(request.query.before) ?? null;
    const sourceFilter = request.query.source === 'upload' || request.query.source === 'chat'
      ? request.query.source : null;

    const items = await prisma.mediaItem.findMany({
      where: {
        departmentId: request.params.id,
        ...(before ? { createdAt: { lt: before } } : {}),
        ...(sourceFilter ? { source: sourceFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        uploadedBy: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
      },
    });

    const hasMore = items.length > limit;
    const slice = items.slice(0, limit);

    return reply.send({
      items: slice.map((m) => ({
        id: m.id,
        title: m.title,
        filename: m.filename,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        isImage: IMAGE_MIMES.has(m.mimeType),
        url: `/api/media/${m.id}/file`,
        thumbUrl: m.thumbS3Key ? `/api/media/${m.id}/thumb` : null,
        source: m.source,
        createdAt: m.createdAt.toISOString(),
        uploadedBy: {
          id: m.uploadedBy.id,
          name: `${m.uploadedBy.firstName} ${m.uploadedBy.lastName}`.trim(),
          avatarColor: m.uploadedBy.avatarColor,
        },
        canDelete: m.uploadedById === request.userId
          || v.ms?.role === Role.admin
          || (v.ms?.role === Role.dept_manager && v.ms.departmentId === m.departmentId),
      })),
      hasMore,
    });
  });

  // Upload a file to the department library.
  app.post<{ Params: { id: string } }>('/departments/:id/media', async (request, reply) => {
    const v = await deptViewerMembership(request.userId!, request.params.id);
    if (!v.allowed) return reply.code(403).send({ error: 'forbidden', message: 'No access to this department' });

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'No file uploaded' });

    const ext = path.extname(file.filename || '').toLowerCase();
    if (BLOCKED_EXTS.has(ext)) {
      return reply.code(415).send({ error: 'blocked_type', message: 'This file type is not allowed' });
    }

    // Buffer the upload with size cap, then optimize + generate thumb in
    // memory and push to storage (S3 or local disk) atomically.
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of file.file) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        return reply.code(413).send({ error: 'too_large', message: 'File exceeds 100 MB' });
      }
      chunks.push(chunk);
    }
    if (file.file.truncated) {
      return reply.code(413).send({ error: 'too_large', message: 'File exceeds 100 MB' });
    }
    let buffer: Buffer = Buffer.concat(chunks) as Buffer;

    let storedMime = file.mimetype || 'application/octet-stream';
    let storedName = file.filename || `file${ext}`;
    try {
      const opt = await optimizeImageBuffer(buffer, storedMime);
      if (opt) {
        buffer = opt.buffer;
        storedMime = opt.mimeType;
        storedName = opt.filename(storedName);
      }
    } catch (err) {
      request.log.warn({ err }, 'media optimization failed, keeping original');
    }

    // Generate thumbnail buffer (images only). Best-effort.
    let thumbBuffer: Buffer | null = null;
    try {
      if (IMAGE_MIMES.has(storedMime)) {
        thumbBuffer = await generateThumbBuffer(buffer, storedMime);
      }
    } catch (err) {
      request.log.warn({ err }, 'thumbnail generation failed');
    }

    const finalExt = path.extname(storedName).toLowerCase() || ext || '';
    const baseKey = `media/${request.params.id}/${crypto.randomBytes(12).toString('hex')}`;
    const objectKey = `${baseKey}${finalExt}`;
    const thumbKey = thumbBuffer ? `${baseKey}_thumb.webp` : null;

    await putObject(objectKey, buffer, storedMime);
    if (thumbBuffer && thumbKey) {
      await putObject(thumbKey, thumbBuffer, 'image/webp');
    }

    const media = await prisma.mediaItem.create({
      data: {
        departmentId: request.params.id,
        uploadedById: request.userId!,
        title: storedName,
        filename: storedName,
        mimeType: storedMime,
        sizeBytes: buffer.length,
        s3Key: objectKey,
        thumbS3Key: thumbKey,
      },
    });

    return reply.code(201).send({
      id: media.id,
      title: media.title,
      filename: media.filename,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      isImage: IMAGE_MIMES.has(media.mimeType),
      url: `/api/media/${media.id}/file`,
      thumbUrl: media.thumbS3Key ? `/api/media/${media.id}/thumb` : null,
      createdAt: media.createdAt.toISOString(),
    });
  });

  // Rename (title only — file on disk stays).
  app.patch<{ Params: { id: string }; Body: { title?: string } }>('/media/:id', async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({ where: { id: request.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found', message: 'Item not found' });
    const v = await deptViewerMembership(request.userId!, item.departmentId);
    if (!v.allowed) return reply.code(403).send({ error: 'forbidden', message: 'No access' });
    const isOwner = item.uploadedById === request.userId;
    const isManager = v.ms?.role === Role.admin || v.ms?.role === Role.dept_manager;
    if (!isOwner && !isManager) return reply.code(403).send({ error: 'forbidden', message: 'Only the uploader or a department manager can rename' });

    const title = (request.body?.title || '').trim();
    if (!title || title.length > 255) {
      return reply.code(400).send({ error: 'invalid_title', message: 'Title must be 1-255 characters' });
    }
    const updated = await prisma.mediaItem.update({ where: { id: item.id }, data: { title } });
    return reply.send({ id: updated.id, title: updated.title });
  });

  // Delete (uploader, dept_manager of the dept, or admin).
  app.delete<{ Params: { id: string } }>('/media/:id', async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({ where: { id: request.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found', message: 'Item not found' });
    const v = await deptViewerMembership(request.userId!, item.departmentId);
    if (!v.allowed) return reply.code(403).send({ error: 'forbidden', message: 'No access' });
    const isOwner = item.uploadedById === request.userId;
    const isManager = v.ms?.role === Role.admin || v.ms?.role === Role.dept_manager;
    if (!isOwner && !isManager) return reply.code(403).send({ error: 'forbidden', message: 'Only the uploader or a department manager can delete' });

    await prisma.mediaItem.delete({ where: { id: item.id } });
    await deleteObject(item.s3Key);
    if (item.thumbS3Key) await deleteObject(item.thumbS3Key);
    return reply.code(204).send();
  });

  // Stream the file (auth + dept visibility).
  app.get<{ Params: { id: string } }>('/media/:id/file', async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({ where: { id: request.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found', message: 'Item not found' });
    const v = await deptViewerMembership(request.userId!, item.departmentId);
    if (!v.allowed) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const buffer = await getObjectBuffer(item.s3Key);
    if (!buffer) return reply.code(404).send({ error: 'file_missing', message: 'File no longer in storage' });
    const dl = safeDownloadHeaders(item.mimeType, item.filename);
    return reply
      .header('content-type', dl.contentType)
      .header('content-disposition', dl.contentDisposition)
      .send(buffer);
  });

  // Thumbnail stream — falls back to 404 if not generated (non-image types).
  app.get<{ Params: { id: string } }>('/media/:id/thumb', async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({ where: { id: request.params.id } });
    if (!item || !item.thumbS3Key) return reply.code(404).send({ error: 'not_found', message: 'No thumbnail' });
    const v = await deptViewerMembership(request.userId!, item.departmentId);
    if (!v.allowed) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const buffer = await getObjectBuffer(item.thumbS3Key);
    if (!buffer) return reply.code(404).send({ error: 'file_missing', message: 'Thumb no longer in storage' });
    return reply
      .header('content-type', 'image/webp')
      .header('cache-control', 'private, max-age=86400')
      .send(buffer);
  });
}
