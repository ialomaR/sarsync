import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Idempotent-ish: wipe and reseed
  await prisma.activity.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.cardLabel.deleteMany();
  await prisma.cardMember.deleteMany();
  await prisma.card.deleteMany();
  await prisma.list.deleteMany();
  await prisma.board.deleteMany();
  await prisma.label.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.team.deleteMany();
  await prisma.department.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.oAuthAccount.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('sarsync-secret', 10);

  // Users
  const users = await prisma.$transaction([
    prisma.user.create({ data: { email: 'lina@sarsync.com',  firstName: 'Lina',  lastName: 'Park',         passwordHash, avatarColor: '#111827', emailVerified: new Date() } }),
    prisma.user.create({ data: { email: 'sara@sarsync.com',  firstName: 'Sara',  lastName: 'Al-Mutairi',   passwordHash, avatarColor: '#7C5CFF', emailVerified: new Date() } }),
    prisma.user.create({ data: { email: 'dev@sarsync.com',   firstName: 'Dev',   lastName: 'Iyer',         passwordHash, avatarColor: '#3B82F6', emailVerified: new Date() } }),
    prisma.user.create({ data: { email: 'aisha@sarsync.com', firstName: 'Aïsha', lastName: 'N.',           passwordHash, avatarColor: '#E55D87', emailVerified: new Date(), locale: 'ar' } }),
    prisma.user.create({ data: { email: 'maya@sarsync.com',  firstName: 'Maya',  lastName: 'Reyes',        passwordHash, avatarColor: '#22B8A0', emailVerified: new Date() } }),
    prisma.user.create({ data: { email: 'reem@sarsync.com',  firstName: 'Reem',  lastName: 'Hadid',        passwordHash, avatarColor: '#0EA5E9', emailVerified: new Date(), locale: 'ar' } }),
  ]);
  const [lina, sara, dev, aisha, maya, reem] = users;

  // Workspace
  const ws = await prisma.workspace.create({
    data: { slug: 'atlas', name: 'Atlas Studio', hue: 220 },
  });

  // Departments (labels are created per-board further down)
  const deptDesign = await prisma.department.create({ data: { workspaceId: ws.id, name: 'Design',      nameAr: 'التصميم',        icon: '◇', hue: 320 } });
  const deptEng    = await prisma.department.create({ data: { workspaceId: ws.id, name: 'Engineering', nameAr: 'الهندسة',         icon: '⌘', hue: 220 } });
  const deptMkt    = await prisma.department.create({ data: { workspaceId: ws.id, name: 'Marketing',   nameAr: 'التسويق',         icon: '↗', hue: 28 } });

  // Teams
  const teamProduct  = await prisma.team.create({ data: { workspaceId: ws.id, departmentId: deptDesign.id, name: 'Product Design', nameAr: 'تصميم المنتج' } });
  const teamPlatform = await prisma.team.create({ data: { workspaceId: ws.id, departmentId: deptEng.id,    name: 'Platform',        nameAr: 'المنصّة' } });
  const teamGrowth   = await prisma.team.create({ data: { workspaceId: ws.id, departmentId: deptMkt.id,    name: 'Growth',          nameAr: 'النمو' } });

  // Memberships (roles)
  const memberships = await prisma.$transaction([
    prisma.membership.create({ data: { userId: lina.id,  workspaceId: ws.id, role: Role.admin } }),
    prisma.membership.create({ data: { userId: sara.id,  workspaceId: ws.id, role: Role.dept_manager, departmentId: deptDesign.id, teamId: teamProduct.id } }),
    prisma.membership.create({ data: { userId: dev.id,   workspaceId: ws.id, role: Role.dept_manager, departmentId: deptEng.id,    teamId: teamPlatform.id } }),
    prisma.membership.create({ data: { userId: aisha.id, workspaceId: ws.id, role: Role.dept_manager, departmentId: deptMkt.id,    teamId: teamGrowth.id } }),
    prisma.membership.create({ data: { userId: maya.id,  workspaceId: ws.id, role: Role.member,       departmentId: deptDesign.id, teamId: teamProduct.id } }),
    prisma.membership.create({ data: { userId: reem.id,  workspaceId: ws.id, role: Role.member,       departmentId: deptDesign.id, teamId: teamProduct.id } }),
  ]);

  // Set heads/leads
  await prisma.department.update({ where: { id: deptDesign.id }, data: { headId: memberships[1].id } });
  await prisma.department.update({ where: { id: deptEng.id },    data: { headId: memberships[2].id } });
  await prisma.department.update({ where: { id: deptMkt.id },    data: { headId: memberships[3].id } });
  await prisma.team.update({ where: { id: teamProduct.id }, data: { leadId: memberships[1].id } });

  // Board: Q3 Roadmap (with default labels — board-scoped)
  const board = await prisma.board.create({
    data: {
      workspaceId: ws.id, departmentId: deptDesign.id, teamId: teamProduct.id,
      title: 'Q3 Product Roadmap', subtitle: 'Cross-functional · 12 members',
      hue: 220,
      labels: {
        create: [
          { name: 'Feature',  color: '#3B82F6', bg: '#E0EBFF' },
          { name: 'Bug',      color: '#DC2626', bg: '#FEE2E2' },
          { name: 'Research', color: '#7C3AED', bg: '#EDE3FF' },
          { name: 'Design',   color: '#DB2777', bg: '#FCE4EF' },
          { name: 'Infra',    color: '#0E7C66', bg: '#D7F1E9' },
          { name: 'Copy',     color: '#B45309', bg: '#FEF0CC' },
          { name: 'Urgent',   color: '#B91C1C', bg: '#FECACA' },
        ],
      },
    },
    include: { labels: true },
  });
  const labelByName = Object.fromEntries(board.labels.map((l) => [l.name, l]));
  const lblFeature  = labelByName['Feature'];
  const lblBug      = labelByName['Bug'];
  const lblResearch = labelByName['Research'];
  const lblDesign   = labelByName['Design'];
  const lblInfra    = labelByName['Infra'];
  const lblUrgent   = labelByName['Urgent'];

  // Lists
  const lists = await prisma.$transaction([
    prisma.list.create({ data: { boardId: board.id, title: 'Backlog',     position: 1024 } }),
    prisma.list.create({ data: { boardId: board.id, title: 'Design',      position: 2048 } }),
    prisma.list.create({ data: { boardId: board.id, title: 'In Progress', position: 3072 } }),
    prisma.list.create({ data: { boardId: board.id, title: 'In Review',   position: 4096 } }),
    prisma.list.create({ data: { boardId: board.id, title: 'Shipped',     position: 5120 } }),
  ]);
  const [backlog, design, doing, review, shipped] = lists;

  // Cards (sample subset)
  await prisma.card.create({
    data: {
      listId: backlog.id, title: 'User research: notification fatigue',
      position: 1024, due: new Date('2026-09-14'), createdById: maya.id,
      labels:  { create: [{ labelId: lblResearch.id }] },
      members: { create: [{ userId: maya.id }] },
    },
  });
  await prisma.card.create({
    data: {
      listId: design.id, title: 'Onboarding v3 — empty states',
      description: 'Refresh first-run empty states across Inbox, Boards, and Settings.',
      position: 1024, due: new Date('2026-09-09'), createdById: sara.id,
      coverHue: 28, coverLabel: 'flow.fig',
      labels:  { create: [{ labelId: lblDesign.id }, { labelId: lblFeature.id }] },
      members: { create: [{ userId: sara.id }] },
      checklist: {
        create: [
          { text: 'Audit current empty states',  done: true,  position: 1024 },
          { text: 'Sketch direction (3 options)', done: true,  position: 2048 },
          { text: 'Hi-fi mocks for Inbox',        done: false, position: 3072 },
        ],
      },
    },
  });
  await prisma.card.create({
    data: {
      listId: doing.id, title: 'Crash on attachment preview iOS 17',
      position: 1024, due: new Date('2026-09-02'), createdById: dev.id,
      coverHue: 12, coverLabel: 'crash log',
      labels:  { create: [{ labelId: lblBug.id }, { labelId: lblUrgent.id }] },
      members: { create: [{ userId: dev.id }] },
    },
  });
  await prisma.card.create({
    data: {
      listId: shipped.id, title: 'Two-factor auth (TOTP)',
      position: 1024, createdById: dev.id,
      labels:  { create: [{ labelId: lblFeature.id }, { labelId: lblInfra.id }] },
      members: { create: [{ userId: dev.id }] },
    },
  });

  console.log('✓ Seeded workspace:', ws.slug, '— login: sara@sarsync.com / sarsync-secret');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
