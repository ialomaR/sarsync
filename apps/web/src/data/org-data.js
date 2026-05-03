// Organization model — departments, teams, members with roles, projects.

export const DEPARTMENTS = [
  { id: 'eng',       name: 'Engineering',      icon: '⌘', hue: 220, head: 'dv', members: 14, projects: 8 },
  { id: 'design',    name: 'Design',           icon: '◇', hue: 320, head: 'sa', members: 6,  projects: 5 },
  { id: 'mkt',       name: 'Marketing',        icon: '↗', hue: 28,  head: 'an', members: 9,  projects: 6 },
  { id: 'support',   name: 'Customer Support', icon: '⚐', hue: 160, head: 'mr', members: 12, projects: 4 },
  { id: 'people',    name: 'People & Ops',     icon: '○', hue: 280, head: 'tw', members: 5,  projects: 3 },
];

export const TEAMS = [
  { id: 't-platform',  name: 'Platform',          dept: 'eng',     lead: 'dv', members: ['dv','tw'] },
  { id: 't-mobile',    name: 'Mobile Apps',       dept: 'eng',     lead: 'jk', members: ['jk','dv'] },
  { id: 't-product',   name: 'Product Design',    dept: 'design',  lead: 'sa', members: ['sa','mr'] },
  { id: 't-brand',     name: 'Brand & Web',       dept: 'design',  lead: 'mr', members: ['mr','an'] },
  { id: 't-growth',    name: 'Growth',            dept: 'mkt',     lead: 'an', members: ['an'] },
  { id: 't-content',   name: 'Content',           dept: 'mkt',     lead: 'an', members: ['an','tw'] },
  { id: 't-tier1',     name: 'Tier 1',            dept: 'support', lead: 'mr', members: ['mr','jk'] },
  { id: 't-recruit',   name: 'Recruiting',        dept: 'people',  lead: 'tw', members: ['tw'] },
];

export const ROLES = {
  admin:        { label: 'Admin',           desc: 'Full org access',                    color: '#7C3AED' },
  dept_manager: { label: 'Dept. Manager',   desc: 'Manage their department',            color: '#3B82F6' },
  team_lead:    { label: 'Team Lead',       desc: 'Manage their team\'s projects',      color: '#0E7C66' },
  member:       { label: 'Member',          desc: 'See own work + team projects',       color: '#6B7280' },
  guest:        { label: 'Guest',           desc: 'Read-only on shared boards',         color: '#A89478' },
};

export const ORG_MEMBERS = [
  { id: 'admin1', name: 'Lina Park',          initials: 'LP', color: '#111827', role: 'admin',        dept: null,       team: null,           email: 'lina@sarsync.com',     joined: 'Jan 2024' },
  { id: 'sa',     name: 'Sara Al-Mutairi',    initials: 'SA', color: '#7C5CFF', role: 'dept_manager', dept: 'design',   team: 't-product',    email: 'sara@sarsync.com',     joined: 'Mar 2024' },
  { id: 'dv',     name: 'Dev Iyer',           initials: 'DV', color: '#3B82F6', role: 'dept_manager', dept: 'eng',      team: 't-platform',   email: 'dev@sarsync.com',      joined: 'Feb 2024' },
  { id: 'an',     name: 'Aïsha N.',           initials: 'AN', color: '#E55D87', role: 'dept_manager', dept: 'mkt',      team: 't-growth',     email: 'aisha@sarsync.com',    joined: 'Apr 2024' },
  { id: 'mr',     name: 'Maya Reyes',         initials: 'MR', color: '#22B8A0', role: 'dept_manager', dept: 'support',  team: 't-tier1',      email: 'maya@sarsync.com',     joined: 'May 2024' },
  { id: 'tw',     name: 'Theo Walsh',         initials: 'TW', color: '#F2B14A', role: 'dept_manager', dept: 'people',   team: 't-recruit',    email: 'theo@sarsync.com',     joined: 'Jun 2024' },
  { id: 'jk',     name: 'Jamal Khalid',       initials: 'JK', color: '#FF7A59', role: 'team_lead',    dept: 'eng',      team: 't-mobile',     email: 'jamal@sarsync.com',    joined: 'Jul 2024' },
  { id: 'm6',     name: 'Reem Hadid',         initials: 'RH', color: '#0EA5E9', role: 'member',       dept: 'design',   team: 't-product',    email: 'reem@sarsync.com',     joined: 'Aug 2024' },
  { id: 'm7',     name: 'Noah Chen',          initials: 'NC', color: '#F472B6', role: 'member',       dept: 'eng',      team: 't-platform',   email: 'noah@sarsync.com',     joined: 'Sep 2024' },
  { id: 'm8',     name: 'Yara Saleh',         initials: 'YS', color: '#10B981', role: 'member',       dept: 'eng',      team: 't-mobile',     email: 'yara@sarsync.com',     joined: 'Oct 2024' },
  { id: 'm9',     name: 'Karim Belkacem',     initials: 'KB', color: '#A855F7', role: 'member',       dept: 'mkt',      team: 't-content',    email: 'karim@sarsync.com',    joined: 'Nov 2024' },
  { id: 'm10',    name: 'Ines Moreau',        initials: 'IM', color: '#F59E0B', role: 'member',       dept: 'design',   team: 't-brand',      email: 'ines@sarsync.com',     joined: 'Dec 2024' },
  { id: 'g1',     name: 'External · Vendor',  initials: 'EV', color: '#9CA3AF', role: 'guest',        dept: null,       team: null,           email: 'vendor@partner.io',  joined: 'Mar 2026' },
];

export const PERMS = [
  { key: 'view_all',      label: 'View all boards',          admin: true,  dept_manager: false, team_lead: false, member: false, guest: false },
  { key: 'view_dept',     label: 'View department boards',   admin: true,  dept_manager: true,  team_lead: true,  member: true,  guest: false },
  { key: 'view_team',     label: 'View team boards',         admin: true,  dept_manager: true,  team_lead: true,  member: true,  guest: false },
  { key: 'edit_team',     label: 'Edit team boards',         admin: true,  dept_manager: true,  team_lead: true,  member: true,  guest: false },
  { key: 'create_proj',   label: 'Create new projects',      admin: true,  dept_manager: true,  team_lead: true,  member: false, guest: false },
  { key: 'invite',        label: 'Invite members',           admin: true,  dept_manager: true,  team_lead: false, member: false, guest: false },
  { key: 'manage_dept',   label: 'Manage department',        admin: true,  dept_manager: true,  team_lead: false, member: false, guest: false },
  { key: 'manage_org',    label: 'Manage organization',      admin: true,  dept_manager: false, team_lead: false, member: false, guest: false },
  { key: 'billing',       label: 'Billing & invoices',       admin: true,  dept_manager: false, team_lead: false, member: false, guest: false },
];

export const PROJECTS = [
  { id: 'p1',  title: 'Q3 Product Roadmap',     dept: 'design',  team: 't-product',  hue: 320, lists: 5, cards: 24, status: 'on-track', updated: '2h ago',  due: 'Sep 30' },
  { id: 'p2',  title: 'Design System v2',       dept: 'design',  team: 't-product',  hue: 340, lists: 5, cards: 27, status: 'on-track', updated: 'Mon',     due: 'Oct 12' },
  { id: 'p3',  title: 'Brand refresh — site',   dept: 'design',  team: 't-brand',    hue: 28,  lists: 4, cards: 19, status: 'at-risk',  updated: 'Yesterday', due: 'Sep 22' },
  { id: 'p4',  title: 'Mobile · Sprint 41',     dept: 'eng',     team: 't-mobile',   hue: 220, lists: 6, cards: 31, status: 'on-track', updated: '3h ago',  due: 'Sep 19' },
  { id: 'p5',  title: 'Platform · API v3',      dept: 'eng',     team: 't-platform', hue: 240, lists: 5, cards: 22, status: 'on-track', updated: '5h ago',  due: 'Oct 04' },
  { id: 'p6',  title: 'Inbox 4.0 launch',       dept: 'mkt',     team: 't-growth',   hue: 28,  lists: 4, cards: 18, status: 'on-track', updated: 'Yesterday', due: 'Sep 25' },
  { id: 'p7',  title: 'Q3 Content calendar',    dept: 'mkt',     team: 't-content',  hue: 50,  lists: 5, cards: 23, status: 'on-track', updated: '1d ago',  due: 'rolling' },
  { id: 'p8',  title: 'Customer feedback loop', dept: 'support', team: 't-tier1',    hue: 160, lists: 4, cards: 42, status: 'on-track', updated: '5d ago',  due: 'rolling' },
  { id: 'p9',  title: 'Hiring — Q3 Eng',         dept: 'people',  team: 't-recruit',  hue: 280, lists: 5, cards: 13, status: 'at-risk',  updated: 'Aug 28',  due: 'Sep 30' },
];

export const MY_TASKS = [
  { id: 'mt1', title: 'Hi-fi mocks for Inbox empty state', project: 'p1', list: 'Design',     due: 'Sep 9',  priority: 'high',   labels: ['design'] },
  { id: 'mt2', title: 'Review brand palette options',      project: 'p3', list: 'In Review',  due: 'Sep 7',  priority: 'med',    labels: ['design'] },
  { id: 'mt3', title: 'Sync with Eng on tokens API',       project: 'p2', list: 'Doing',      due: 'Sep 6',  priority: 'med',    labels: ['design'] },
  { id: 'mt4', title: 'Draft onboarding copy',             project: 'p1', list: 'Backlog',    due: 'Sep 14', priority: 'low',    labels: ['copy'] },
  { id: 'mt5', title: 'Settings IA review notes',          project: 'p1', list: 'Doing',      due: 'Sep 5',  priority: 'high',   labels: ['design','feature'] },
];

export function visibleProjects(role, deptId, teamId) {
  if (role === 'admin') return PROJECTS;
  if (role === 'dept_manager') return PROJECTS.filter((p) => p.dept === deptId);
  if (role === 'team_lead' || role === 'member') {
    return PROJECTS.filter((p) => p.dept === deptId);
  }
  return [];
}

export function visibleMembers(role, deptId, teamId) {
  if (role === 'admin') return ORG_MEMBERS;
  if (role === 'dept_manager') return ORG_MEMBERS.filter((m) => m.dept === deptId);
  return ORG_MEMBERS.filter((m) => m.team === teamId);
}
