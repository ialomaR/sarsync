// Shared types between API and web — single source of truth for the wire format.

export type Role = 'admin' | 'dept_manager' | 'team_lead' | 'member' | 'guest';

export type ProjectStatus = 'on-track' | 'at-risk' | 'off-track';

export type Priority = 'high' | 'med' | 'low';

export interface User {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  role: Role;
  departmentId: string | null;
  teamId: string | null;
}

export interface Department {
  id: string;
  name: string;
  icon: string;
  hue: number;
  headId: string | null;
}

export interface Team {
  id: string;
  name: string;
  departmentId: string;
  leadId: string | null;
}

export interface Card {
  id: string;
  listId: string;
  title: string;
  description: string | null;
  position: number;
  due: string | null;
  coverHue: number | null;
  coverLabel: string | null;
  labelIds: string[];
  memberIds: string[];
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
}

export interface List {
  id: string;
  boardId: string;
  title: string;
  position: number;
  cards: Card[];
}

export interface Board {
  id: string;
  title: string;
  subtitle: string | null;
  hue: number;
  starred: boolean;
  departmentId: string | null;
  teamId: string | null;
  lists: List[];
}

// Auth wire types

export interface SignInRequest {
  email: string;
  password: string;
}

export interface SignUpRequest {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  workspaceName: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarColor: string;
  locale: string;
}

export interface MembershipSummary {
  id: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  workspaceHue: number;
  role: Role;
  departmentId: string | null;
  teamId: string | null;
  memberCount: number;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  memberships: MembershipSummary[];
}

export interface MeResponse {
  user: AuthUser;
  memberships: MembershipSummary[];
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
