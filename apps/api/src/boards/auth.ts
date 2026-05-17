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
    include: { workspace: { select: { suspendedAt: true } } },
  });
  if (!m) return reply.code(403).send({ error: 'forbidden', message: 'Not a member of this workspace' });
  if (m.workspace.suspendedAt) {
    return reply.code(423).send({
      error: 'workspace_suspended',
      message: 'This workspace has been suspended by the platform administrator.',
    });
  }
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
//
// Editability ALWAYS implies visibility — a user who can edit can also see
// the board (canViewBoard). The reverse isn't true: guests view but can't
// edit. The two rules are kept in sync so users never hit "I can see it but
// can't change it" on workspace-wide content.
export function canEditBoard(
  membership: { role: Role; departmentId: string | null; teamId: string | null; boardAccessIds?: Set<string> },
  board: { id?: string; departmentId: string | null; teamId: string | null },
): boolean {
  if (membership.role === Role.admin) return true;
  if (membership.role === Role.guest) return false;
  // Workspace-wide boards (no dept) are open to every non-guest member —
  // matches the visibility rule. This covers cross-functional projects and
  // any board created before/without a department being assigned.
  if (!board.departmentId) return true;
  // Dept-scoped: editable by anyone whose membership is in that dept.
  if (membership.departmentId && membership.departmentId === board.departmentId) return true;
  // Team-scoped: editable by team members.
  if (board.teamId && membership.teamId === board.teamId) return true;
  // Explicit per-board access (cross-dept assignment, Trello/Linear style).
  if (board.id && membership.boardAccessIds?.has(board.id)) return true;
  return false;
}

// Card-level edit: title, due date, delete. Tighter than canEditBoard because
// these belong to the card's identity and stay "owned" by its creator.
//   - admin: any card
//   - dept_manager: any card on a board in their department
//   - team_lead / member: only cards they created themselves
//   - guest: never
// Description, cover, checklist, comments, member assignment, and attachments
// stay under canEditBoard — they're collaborative work *on* the card. Every
// such edit still records the actor in the activity log, so attribution is
// preserved even when the author isn't the creator.
export function canEditCard(
  membership: { userId: string; role: Role; departmentId: string | null },
  card: { createdById: string | null },
  board: { departmentId: string | null },
): boolean {
  if (membership.role === Role.admin) return true;
  if (membership.role === Role.guest) return false;
  if (card.createdById && card.createdById === membership.userId) return true;
  if (membership.role === Role.dept_manager
      && board.departmentId
      && board.departmentId === membership.departmentId) return true;
  return false;
}

// Board-level management: rename, archive, change dept/team assignment.
// Reserved for users responsible for the board's home org. Cross-dept
// assignees do NOT inherit manage access — their seniority elsewhere
// doesn't carry over. Workspace-wide boards (no dept) are managed by
// admins only.
export function canManageBoard(
  membership: { role: Role; departmentId: string | null; teamId: string | null },
  board: { departmentId: string | null; teamId: string | null },
): boolean {
  if (membership.role === Role.admin) return true;
  if (membership.role === Role.guest) return false;
  // Workspace-wide → admin only (already returned above)
  if (!board.departmentId) return false;
  if (membership.role === Role.dept_manager && board.departmentId === membership.departmentId) return true;
  if (membership.role === Role.team_lead && board.teamId && membership.teamId === board.teamId) return true;
  return false;
}
