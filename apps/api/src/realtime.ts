// Real-time event broadcasting via Socket.io.
//
// Channels:
//   - board:<boardId>     — anyone viewing the board joins. Broadcast: card moved/added/edited, list added/renamed/deleted, board updated.
//   - user:<userId>       — auto-joined on connect. Broadcast: new notifications.
//
// Auth: client passes the access token via the `auth.token` field on connect;
// we verify it once and stash userId on the socket.

import { Server as IOServer, Socket } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { verifyAccessToken } from './auth/tokens.js';
import { prisma } from './db.js';
import { canViewBoard } from './boards/auth.js';

let io: IOServer | null = null;

export function getIO(): IOServer | null {
  return io;
}

export function attachSocketIO(app: FastifyInstance, origin: string) {
  io = new IOServer(app.server, {
    cors: { origin, credentials: true },
    path: '/socket.io',
  });

  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('no_token'));
      const payload = verifyAccessToken(token);
      (socket as Socket & { userId?: string }).userId = payload.sub;
      // Auto-join the user's personal room for notifications
      socket.join(`user:${payload.sub}`);
      next();
    } catch (err) {
      next(new Error('invalid_token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket as Socket & { userId?: string }).userId!;

    // Join a board room — verify visibility first
    socket.on('board:join', async (boardId: string) => {
      if (typeof boardId !== 'string') return;
      try {
        const board = await prisma.board.findUnique({ where: { id: boardId } });
        if (!board) return;
        const ms = await prisma.membership.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: board.workspaceId } },
        });
        if (!ms) return;
        // Also pull explicit board access for cross-dept assignments
        const explicit = await prisma.boardMember.findUnique({
          where: { boardId_userId: { boardId, userId } },
          select: { boardId: true },
        });
        const enriched = { ...ms, boardAccessIds: new Set(explicit ? [boardId] : []) };
        if (!canViewBoard(enriched, board)) return;
        socket.join(`board:${boardId}`);
      } catch {}
    });

    socket.on('board:leave', (boardId: string) => {
      if (typeof boardId === 'string') socket.leave(`board:${boardId}`);
    });

    // Department chat room. Same visibility rule as the chat REST endpoints:
    // dept members + admins. Cross-dept users (BoardMember grant on a board
    // in this dept) do NOT get chat access — chat is scoped to dept.
    socket.on('dept:join', async (deptId: string) => {
      if (typeof deptId !== 'string') return;
      try {
        const dept = await prisma.department.findUnique({ where: { id: deptId } });
        if (!dept) return;
        const ms = await prisma.membership.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: dept.workspaceId } },
        });
        if (!ms) return;
        if (ms.role === Role.guest) return;
        if (ms.role !== Role.admin && ms.departmentId !== deptId) return;
        socket.join(`dept:${deptId}`);
      } catch {}
    });

    socket.on('dept:leave', (deptId: string) => {
      if (typeof deptId === 'string') socket.leave(`dept:${deptId}`);
    });
  });

  app.log.info('🔌 Socket.io attached');
}

// ── Helpers used by route handlers to broadcast updates ────────────────────

// Broadcast to everyone in the board room, optionally excluding the originating
// socket (NOT the originating user) so that other tabs of the same user still
// see the change. Pass the value of the X-Socket-Id request header.
export function emitBoardEvent(boardId: string, kind: string, payload: unknown, exceptSocketId?: string) {
  if (!io) return;
  const room = `board:${boardId}`;
  if (exceptSocketId) {
    io.in(room).except(exceptSocketId).emit(kind, payload);
  } else {
    io.to(room).emit(kind, payload);
  }
}

// Pull the originating socket id from a Fastify request. Returns undefined
// when the client didn't attach the header (e.g. tests, server-initiated
// emits).
export function actorSocketId(req: { headers: Record<string, unknown> }): string | undefined {
  const h = req.headers['x-socket-id'];
  return typeof h === 'string' && h.length > 0 ? h : undefined;
}

export function emitUserEvent(userId: string, kind: string, payload: unknown) {
  if (!io) return;
  io.to(`user:${userId}`).emit(kind, payload);
}

// Department-scoped chat broadcasts. Same per-socket exclusion pattern.
export function emitDeptEvent(deptId: string, kind: string, payload: unknown, exceptSocketId?: string) {
  if (!io) return;
  const room = `dept:${deptId}`;
  if (exceptSocketId) {
    io.in(room).except(exceptSocketId).emit(kind, payload);
  } else {
    io.to(room).emit(kind, payload);
  }
}
