import type { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';

declare module 'fastify' {
  interface FastifyRequest {
    membership?: {
      id: string;
      userId: string;
      workspaceId: string;
      role: Role;
      departmentId: string | null;
      teamId: string | null;
      // Set of board IDs the user has explicit access to (cross-department)
      boardAccessIds: Set<string>;
    };
  }
}

// Loads the user's membership for a given workspace and attaches it to the
// request. Also loads explicit BoardMember rows for cross-dept access.
// Returns 403 if no membership.
export async function loadMembership(
  request: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
) {
  const userId = request.userId;
  if (!userId) return reply.code(401).send({ error: 'unauthorized', message: 'Not authenticated' });
  const m = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!m) return reply.code(403).send({ error: 'forbidden', message: 'Not a member of this workspace' });
  // Pull all boards the user has explicit access to within this workspace
  const explicit = await prisma.boardMember.findMany({
    where: { userId, board: { workspaceId } },
    select: { boardId: true },
  });
  request.membership = {
    id: m.id, userId: m.userId, workspaceId: m.workspaceId,
    role: m.role, departmentId: m.departmentId, teamId: m.teamId,
    boardAccessIds: new Set(explicit.map((e) => e.boardId)),
  };
}

// True when the user has direct workspace access (dept-based) to this board,
// ignoring explicit BoardMember grants. Used when deciding whether a freshly-
// assigned member needs an explicit grant.
export function hasDeptAccess(
  membership: { role: Role; departmentId: string | null },
  board: { departmentId: string | null },
): boolean {
  if (membership.role === Role.admin) return true;
  if (membership.role === Role.guest) return false;
  if (board.departmentId && membership.departmentId === board.departmentId) return true;
  if (!board.departmentId) return true;
  return false;
}

// Permission helpers — mirror the matrix in PERMS (org-data).
export function canViewBoard(
  membership: { role: Role; departmentId: string | null; teamId: string | null; boardAccessIds?: Set<string> },
  board: { id?: string; departmentId: string | null; teamId: string | null },
): boolean {
  if (membership.role === Role.admin) return true;
  if (membership.role === Role.guest) return false;
  // dept_manager, team_lead, member: see boards in their department
  if (board.departmentId && membership.departmentId === board.departmentId) return true;
  // boards with no dept (workspace-wide) visible to all members
  if (!board.departmentId) return true;
  // Explicit per-board access (granted when added to a card on a cross-dept board)
  if (board.id && membership.boardAccessIds?.has(board.id)) return true;
  return false;
}

// Content-level edit: lists, cards, members on cards, labels, checklists,
// comments. Cross-dept assignees (BoardMember) get this — same level as a
// regular member on the host board (Trello/Jira/Linear standard).
export function canEditBoard(
  membership: { role: Role; departmentId: string | null; teamId: string | null; boardAccessIds?: Set<string> },
  board: { id?: string; departmentId: string | null; teamId: string | null },
): boolean {
  if (membership.role === Role.admin) return true;
  if (membership.role === Role.guest) return false;
  if (membership.role === Role.dept_manager && board.departmentId === membership.departmentId) return true;
  // team_lead and member can edit boards in their team
  if (board.teamId && membership.teamId === board.teamId) return true;
  // members can also edit boards in their dept (per the original matrix)
  if (board.departmentId && membership.departmentId === board.departmentId) return true;
  // Explicit per-board access also grants content edit (matches Trello/Linear)
  if (board.id && membership.boardAccessIds?.has(board.id)) return true;
  return false;
}

// Board-level management: rename, archive, change dept/team assignment.
// Reserved for users responsible for the board's home org (admin + the
// owning dept's manager + the owning team's lead). Cross-dept assignees do
// NOT inherit manage access — their seniority elsewhere doesn't carry over.
export function canManageBoard(
  membership: { role: Role; departmentId: string | null; teamId: string | null },
  board: { departmentId: string | null; teamId: string | null },
): boolean {
  if (membership.role === Role.admin) return true;
  if (membership.role === Role.guest) return false;
  if (membership.role === Role.dept_manager && board.departmentId === membership.departmentId) return true;
  if (membership.role === Role.team_lead && board.teamId && membership.teamId === board.teamId) return true;
  return false;
}
