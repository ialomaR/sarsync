import { prisma } from '../db.js';

// Maps DB User → wire AuthUser
export function toAuthUser(u: {
  id: string; email: string; firstName: string; lastName: string;
  avatarColor: string; locale: string;
  emailVerified?: Date | null;
  twoFactorEnabled?: boolean;
  isSystemAdmin?: boolean;
}) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    avatarColor: u.avatarColor,
    locale: u.locale,
    emailVerified: u.emailVerified ? u.emailVerified.toISOString() : null,
    twoFactorEnabled: !!u.twoFactorEnabled,
    isSystemAdmin: !!u.isSystemAdmin,
  };
}

// Loads memberships for a user, hydrated for the workspace picker.
// Includes `boardAccessIds` (per workspace) so the frontend can pass-through
// the same explicit-grant check the server uses — without it, cross-dept
// assignees see the board but the UI hides edit affordances.
export async function loadMembershipSummaries(userId: string) {
  const ms = await prisma.membership.findMany({
    where: { userId },
    include: {
      workspace: { select: { id: true, slug: true, name: true, hue: true } },
    },
  });
  // count workspace members per membership row
  const counts = await prisma.membership.groupBy({
    by: ['workspaceId'],
    _count: { _all: true },
    where: { workspaceId: { in: ms.map((m) => m.workspaceId) } },
  });
  const countByWs = new Map(counts.map((c) => [c.workspaceId, c._count._all]));

  // Explicit board grants (cross-dept access), grouped by workspace
  const grants = await prisma.boardMember.findMany({
    where: { userId },
    select: { boardId: true, board: { select: { workspaceId: true } } },
  });
  const grantsByWs = new Map<string, string[]>();
  for (const g of grants) {
    const arr = grantsByWs.get(g.board.workspaceId) ?? [];
    arr.push(g.boardId);
    grantsByWs.set(g.board.workspaceId, arr);
  }

  return ms.map((m) => ({
    id: m.id,
    workspaceId: m.workspaceId,
    workspaceSlug: m.workspace.slug,
    workspaceName: m.workspace.name,
    workspaceHue: m.workspace.hue,
    role: m.role,
    departmentId: m.departmentId,
    teamId: m.teamId,
    memberCount: countByWs.get(m.workspaceId) ?? 1,
    boardAccessIds: grantsByWs.get(m.workspaceId) ?? [],
  }));
}
