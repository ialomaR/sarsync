// Shared mock data for the Kanban prototype — Product Roadmap board.

export const MEMBERS = [
  { id: 'sa', name: 'Sara Al-Mutairi', initials: 'SA', color: '#7C5CFF' },
  { id: 'jk', name: 'Jamal Khalid',    initials: 'JK', color: '#FF7A59' },
  { id: 'mr', name: 'Maya Reyes',      initials: 'MR', color: '#22B8A0' },
  { id: 'tw', name: 'Theo Walsh',      initials: 'TW', color: '#F2B14A' },
  { id: 'an', name: 'Aïsha N.',        initials: 'AN', color: '#E55D87' },
  { id: 'dv', name: 'Dev Iyer',        initials: 'DV', color: '#3B82F6' },
];

export const LABELS = {
  feature:  { name: 'Feature',  color: '#3B82F6', bg: '#E0EBFF' },
  bug:      { name: 'Bug',      color: '#DC2626', bg: '#FEE2E2' },
  research: { name: 'Research', color: '#7C3AED', bg: '#EDE3FF' },
  design:   { name: 'Design',   color: '#DB2777', bg: '#FCE4EF' },
  infra:    { name: 'Infra',    color: '#0E7C66', bg: '#D7F1E9' },
  copy:     { name: 'Copy',     color: '#B45309', bg: '#FEF0CC' },
  urgent:   { name: 'Urgent',   color: '#B91C1C', bg: '#FECACA' },
};

export const ROADMAP = {
  id: 'roadmap',
  title: 'Q3 Product Roadmap',
  subtitle: 'Cross-functional · 12 members',
  lists: [
    {
      id: 'backlog', title: 'Backlog', cards: [
        { id: 'c1', title: 'User research: notification fatigue', labels: ['research'], members: ['mr'], due: 'Sep 14', checklist: { done: 0, total: 4 }, comments: 2 },
        { id: 'c2', title: 'Spike: vector search for inbox', labels: ['research', 'infra'], members: ['dv'], comments: 1 },
        { id: 'c3', title: 'Pricing page copy refresh', labels: ['copy'], members: ['an'], due: 'Sep 22' },
        { id: 'c4', title: 'Mobile gesture audit', labels: ['design'], members: ['sa', 'jk'] },
      ],
    },
    {
      id: 'design', title: 'Design', cards: [
        { id: 'c5', title: 'Onboarding v3 — empty states', cover: { hue: 28, label: 'flow.fig' }, labels: ['design', 'feature'], members: ['sa'], due: 'Sep 9', checklist: { done: 3, total: 6 }, comments: 5 },
        { id: 'c6', title: 'Dark mode tokens', labels: ['design'], members: ['mr', 'an'], checklist: { done: 12, total: 14 } },
        { id: 'c7', title: 'Settings IA rework', labels: ['design', 'feature'], members: ['sa'], comments: 3 },
      ],
    },
    {
      id: 'doing', title: 'In Progress', cards: [
        { id: 'c8', title: 'Inbox keyboard shortcuts', labels: ['feature'], members: ['dv', 'tw'], due: 'Sep 5', checklist: { done: 5, total: 8 }, comments: 4 },
        { id: 'c9', title: 'Crash on attachment preview iOS 17', cover: { hue: 12, label: 'crash log' }, labels: ['bug', 'urgent'], members: ['jk'], due: 'Sep 2', comments: 11 },
        { id: 'c10', title: 'Migrate billing to new gateway', labels: ['infra'], members: ['dv'], checklist: { done: 2, total: 9 } },
      ],
    },
    {
      id: 'review', title: 'In Review', cards: [
        { id: 'c11', title: 'Workspace switcher polish', labels: ['design', 'feature'], members: ['sa', 'mr'], comments: 2 },
        { id: 'c12', title: 'API rate limiting v2', labels: ['infra'], members: ['dv', 'tw'], due: 'Sep 7', checklist: { done: 6, total: 6 } },
      ],
    },
    {
      id: 'done', title: 'Shipped', cards: [
        { id: 'c13', title: 'Two-factor auth (TOTP)', labels: ['feature', 'infra'], members: ['tw'], comments: 1 },
        { id: 'c14', title: 'Empty-state illustrations', cover: { hue: 160, label: '8 illos · svg' }, labels: ['design'], members: ['mr'] },
        { id: 'c15', title: 'CSV import bug', labels: ['bug'], members: ['jk'] },
      ],
    },
  ],
};

export const BOARDS_HOME = [
  { id: 'roadmap',  title: 'Q3 Product Roadmap',     team: 'Product',     hue: 220, lists: 5, cards: 24, starred: true,  updated: '2h ago' },
  { id: 'mkt',      title: 'Launch — Inbox 4.0',     team: 'Marketing',   hue: 28,  lists: 4, cards: 18, starred: true,  updated: 'Yesterday' },
  { id: 'eng',      title: 'Sprint 41',               team: 'Engineering', hue: 280, lists: 6, cards: 31, starred: false, updated: '3h ago' },
  { id: 'design',   title: 'Design System v2',        team: 'Design',      hue: 340, lists: 5, cards: 27, starred: true,  updated: 'Mon' },
  { id: 'support',  title: 'Customer Feedback',       team: 'Support',     hue: 160, lists: 4, cards: 42, starred: false, updated: '5d ago' },
  { id: 'ops',      title: 'Hiring — Q3',              team: 'People',      hue: 200, lists: 5, cards: 13, starred: false, updated: 'Aug 28' },
];

export const CARD_DETAIL = {
  id: 'c5',
  title: 'Onboarding v3 — empty states',
  list: 'Design',
  cover: { hue: 28, label: 'flow.fig' },
  labels: ['design', 'feature'],
  members: ['sa', 'mr'],
  due: 'Sep 9, 2026',
  description: 'Refresh first-run empty states across Inbox, Boards, and Settings. Each state should explain what lives here, what to do next, and why it matters. Coordinate with copy on tone.',
  checklist: [
    { id: 'k1', text: 'Audit current empty states', done: true },
    { id: 'k2', text: 'Sketch direction (3 options)', done: true },
    { id: 'k3', text: 'Review with PM + Eng', done: true },
    { id: 'k4', text: 'Hi-fi mocks for Inbox', done: false },
    { id: 'k5', text: 'Hi-fi mocks for Boards', done: false },
    { id: 'k6', text: 'Hand off + redlines', done: false },
  ],
  activity: [
    { id: 'a1', who: 'sa', text: 'moved this card from Backlog to Design', when: '2d ago' },
    { id: 'a2', who: 'mr', text: 'added a checklist (6 items)', when: '2d ago' },
    { id: 'a3', who: 'sa', text: 'attached cover flow.fig', when: '1d ago' },
  ],
  comments: [
    { id: 'm1', who: 'mr', text: 'I think we can reuse the Boards illustration for the Settings empty state — saves us a round of art.', when: '6h ago' },
    { id: 'm2', who: 'sa', text: 'Agreed. Let\'s also push tone slightly warmer; current copy reads cold.', when: '4h ago' },
  ],
};
