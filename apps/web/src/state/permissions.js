// Frontend permission helpers — MUST mirror server logic in apps/api/src/boards/auth.ts.
// The server is authoritative; these helpers are only for hiding UI that would
// otherwise produce a forbidden error on click.

// Roles: admin | dept_manager | team_lead | member | guest

function hasExplicitGrant(membership, board) {
  if (!board?.id || !membership?.boardAccessIds) return false;
  // boardAccessIds is an array on the wire; tolerate either array or Set
  return Array.isArray(membership.boardAccessIds)
    ? membership.boardAccessIds.includes(board.id)
    : membership.boardAccessIds.has(board.id);
}

export function canViewBoard(membership, board) {
  if (!membership || !board) return false;
  if (membership.role === 'admin') return true;
  if (membership.role === 'guest') return false;
  if (board.departmentId && membership.departmentId === board.departmentId) return true;
  if (!board.departmentId) return true;
  if (hasExplicitGrant(membership, board)) return true;
  return false;
}

// Content-level edit (cards, lists, labels, members, etc). Cross-dept
// assignees with a BoardMember grant get this — same as a regular board
// member (Trello/Jira/Linear standard).
//
// Mirrors canEditBoard in apps/api/src/boards/auth.ts — keep them in sync.
// Editability always implies visibility (see canViewBoard above).
export function canEditBoard(membership, board) {
  if (!membership || !board) return false;
  if (membership.role === 'admin') return true;
  if (membership.role === 'guest') return false;
  // Workspace-wide → all non-guest members (matches visibility).
  if (!board.departmentId) return true;
  if (membership.departmentId && membership.departmentId === board.departmentId) return true;
  if (board.teamId && membership.teamId === board.teamId) return true;
  if (hasExplicitGrant(membership, board)) return true;
  return false;
}

// Board-level management (rename, archive, change dept/team). Reserved for
// users responsible for the board's home org — their seniority elsewhere
// doesn't carry over. Workspace-wide boards: admin only.
export function canManageBoard(membership, board) {
  if (!membership || !board) return false;
  if (membership.role === 'admin') return true;
  if (membership.role === 'guest') return false;
  if (!board.departmentId) return false;  // workspace-wide → admin only
  if (membership.role === 'dept_manager' && board.departmentId === membership.departmentId) return true;
  if (membership.role === 'team_lead' && board.teamId && membership.teamId === board.teamId) return true;
  return false;
}

// Card-level edit: title, due, delete.
// Mirrors canEditCard in apps/api/src/boards/auth.ts.
// Description, cover, checklist, comments, members, and attachments stay
// under canEditBoard — they're collaborative work on the card. Every edit
// records the actor in the activity log.
export function canEditCard(membership, card, board) {
  if (!membership || !card || !board) return false;
  if (membership.role === 'admin') return true;
  if (membership.role === 'guest') return false;
  if (card.createdById && card.createdById === membership.userId) return true;
  if (membership.role === 'dept_manager'
      && board.departmentId
      && board.departmentId === membership.departmentId) return true;
  return false;
}

export function canDeleteBoard(membership) {
  return membership?.role === 'admin';
}

export function canCreateBoard(membership) {
  if (!membership) return false;
  return ['admin', 'dept_manager', 'team_lead'].includes(membership.role);
}

export function canManageWorkspace(membership) {
  return membership?.role === 'admin';
}

export function canInviteMembers(membership) {
  if (!membership) return false;
  return membership.role === 'admin' || membership.role === 'dept_manager';
}

// Convenience helper — returns the active membership (workspace user has selected).
// Falls back to memberships[0] if activeWorkspaceId hasn't been resolved yet.
export function activeMembership(auth) {
  if (!auth) return null;
  if (auth.activeMembership) return auth.activeMembership;
  return auth.memberships?.[0] || null;
}
