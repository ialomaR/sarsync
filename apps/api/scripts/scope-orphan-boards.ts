// One-off data utility: assign workspace-wide ("orphan") boards to a department.
// Useful when boards were created before role-based auto-scoping covered all
// non-admin roles, leaving them without a departmentId.
//
// Run from apps/api (so dotenv finds .env):
//   npx tsx scripts/scope-orphan-boards.ts "<workspaceName>" "<deptNameAr>"           # dry run
//   npx tsx scripts/scope-orphan-boards.ts "<workspaceName>" "<deptNameAr>" --apply   # commit
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const [, , wsName, deptNameAr, ...flags] = process.argv;
const apply = flags.includes('--apply');

if (!wsName || !deptNameAr) {
  console.error('Usage: npx tsx scripts/scope-orphan-boards.ts <workspaceName> <deptNameAr> [--apply]');
  process.exit(1);
}

const prisma = new PrismaClient();

const ws = await prisma.workspace.findFirst({ where: { name: wsName } });
if (!ws) {
  console.error(`Workspace "${wsName}" not found.`);
  process.exit(1);
}

const dept = await prisma.department.findFirst({
  where: { workspaceId: ws.id, nameAr: deptNameAr },
});
if (!dept) {
  console.error(`Department "${deptNameAr}" not found in workspace "${wsName}".`);
  process.exit(1);
}

const boards = await prisma.board.findMany({
  where: { workspaceId: ws.id, departmentId: null, archivedAt: null },
  select: { id: true, title: true },
});

console.log(`Workspace : ${ws.name} (${ws.id})`);
console.log(`Target    : ${dept.nameAr} (${dept.id})`);
console.log(`Orphans   : ${boards.length}`);
boards.forEach((b) => console.log(`  - ${b.title}  [${b.id}]`));

if (!apply) {
  console.log('\nDry run. Re-run with --apply to move them.');
  await prisma.$disconnect();
  process.exit(0);
}

const r = await prisma.board.updateMany({
  where: { workspaceId: ws.id, departmentId: null, archivedAt: null },
  data: { departmentId: dept.id },
});
console.log(`\nMoved ${r.count} board(s) into "${dept.nameAr}".`);
await prisma.$disconnect();
