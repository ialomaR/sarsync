import { describe, it, expect } from 'vitest';
import { Role } from '@prisma/client';
import { getApp, withCleanDb, signupUser, addMember, authHeader } from './helpers.js';
import { prisma } from '../src/db.js';

describe('boards + permissions', () => {
  withCleanDb();

  async function adminWithDept() {
    const app = await getApp();
    const admin = await signupUser(app);
    const dept = await prisma.department.create({
      data: { workspaceId: admin.membership.workspaceId, name: 'Design' },
    });
    return { app, admin, dept };
  }

  it('admin can create a board, list lists, and edit its title', async () => {
    const { app, admin, dept } = await adminWithDept();
    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${admin.membership.workspaceId}/boards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Roadmap', departmentId: dept.id },
    });
    expect(create.statusCode).toBe(201);
    const board = create.json();
    expect(board.title).toBe('Roadmap');

    const list = await app.inject({
      method: 'GET',
      url: `/workspaces/${admin.membership.workspaceId}/boards`,
      headers: authHeader(admin.accessToken),
    });
    expect(list.json().boards.map((b: { id: string }) => b.id)).toContain(board.id);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/boards/${board.id}`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Roadmap 2.0' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().title).toBe('Roadmap 2.0');
  });

  it('a member of a different department cannot view or edit the board', async () => {
    const { app, admin, dept } = await adminWithDept();
    const otherDept = await prisma.department.create({
      data: { workspaceId: admin.membership.workspaceId, name: 'Marketing' },
    });
    const stranger = await addMember(app, admin.membership.workspaceId, {
      role: Role.member, departmentId: otherDept.id,
    });
    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${admin.membership.workspaceId}/boards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Design Sprint', departmentId: dept.id },
    });
    const board = create.json();

    const view = await app.inject({
      method: 'GET',
      url: `/boards/${board.id}`,
      headers: authHeader(stranger.accessToken),
    });
    expect(view.statusCode).toBe(403);

    const edit = await app.inject({
      method: 'PATCH',
      url: `/boards/${board.id}`,
      headers: authHeader(stranger.accessToken),
      payload: { title: 'hijacked' },
    });
    expect(edit.statusCode).toBe(403);
  });

  it('cross-dept assignee gets edit access for cards/lists but NOT manage (rename/archive)', async () => {
    const { app, admin, dept } = await adminWithDept();
    const otherDept = await prisma.department.create({
      data: { workspaceId: admin.membership.workspaceId, name: 'Engineering' },
    });
    // Stranger is dept_manager of Engineering — has high seniority elsewhere,
    // but on this board they should still only get content edit, not manage.
    const stranger = await addMember(app, admin.membership.workspaceId, {
      role: Role.dept_manager, departmentId: otherDept.id,
    });
    // Create a Design board with one list + one card
    const board = (await app.inject({
      method: 'POST',
      url: `/workspaces/${admin.membership.workspaceId}/boards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Sprint', departmentId: dept.id },
    })).json();
    const detail = (await app.inject({
      method: 'GET', url: `/boards/${board.id}`, headers: authHeader(admin.accessToken),
    })).json();
    const listId = detail.lists[0].id;
    const card = (await app.inject({
      method: 'POST',
      url: `/lists/${listId}/cards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Logo refresh' },
    })).json();

    // Assign stranger → grants explicit board access
    const assign = await app.inject({
      method: 'POST',
      url: `/cards/${card.id}/members`,
      headers: authHeader(admin.accessToken),
      payload: { userId: stranger.id },
    });
    expect(assign.statusCode).toBe(201);

    // Stranger can now SEE the board
    const view = await app.inject({
      method: 'GET', url: `/boards/${board.id}`, headers: authHeader(stranger.accessToken),
    });
    expect(view.statusCode).toBe(200);

    // Stranger can add a list (content edit)
    const addList = await app.inject({
      method: 'POST', url: `/boards/${board.id}/lists`,
      headers: authHeader(stranger.accessToken), payload: { title: 'Cross-dept' },
    });
    expect(addList.statusCode).toBe(201);

    // Stranger CANNOT rename the board (manage)
    const rename = await app.inject({
      method: 'PATCH', url: `/boards/${board.id}`,
      headers: authHeader(stranger.accessToken), payload: { title: 'hijacked' },
    });
    expect(rename.statusCode).toBe(403);

    // Stranger CANNOT archive
    const archive = await app.inject({
      method: 'POST', url: `/boards/${board.id}/archive`,
      headers: authHeader(stranger.accessToken),
    });
    expect(archive.statusCode).toBe(403);
  });

  it('dept_manager can add cards to a workspace-wide board (no dept)', async () => {
    // Reproduces the bug: dept_manager invited without a department,
    // creates a board (which auto-saves with departmentId=null), then
    // tries to add a card. The fix lets workspace-wide boards be edited
    // by every non-guest member.
    const app = await getApp();
    const admin = await signupUser(app);
    const ws = admin.membership.workspaceId;
    // Member with dept_manager role but NO department assigned — what
    // happens when an admin invites someone without picking a dept.
    const dm = await addMember(app, ws, { role: Role.dept_manager, departmentId: null });

    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${ws}/boards`,
      headers: authHeader(dm.accessToken),
      payload: { title: 'Workspace-wide initiative' },
    });
    expect(create.statusCode).toBe(201);
    const board = create.json();
    expect(board.departmentId).toBeNull();

    const detail = (await app.inject({
      method: 'GET', url: `/boards/${board.id}`, headers: authHeader(dm.accessToken),
    })).json();

    // Add a card — this is what the user reported as broken.
    const card = await app.inject({
      method: 'POST',
      url: `/lists/${detail.lists[0].id}/cards`,
      headers: authHeader(dm.accessToken),
      payload: { title: 'First card on a workspace board' },
    });
    expect(card.statusCode).toBe(201);

    // Add a list too — also content-edit.
    const list = await app.inject({
      method: 'POST',
      url: `/boards/${board.id}/lists`,
      headers: authHeader(dm.accessToken),
      payload: { title: 'Done' },
    });
    expect(list.statusCode).toBe(201);

    // BUT — workspace-wide boards: only admin can rename/archive (manage).
    const rename = await app.inject({
      method: 'PATCH',
      url: `/boards/${board.id}`,
      headers: authHeader(dm.accessToken),
      payload: { title: 'hijacked' },
    });
    expect(rename.statusCode).toBe(403);
  });

  it('member with no dept can edit workspace-wide boards but not dept boards', async () => {
    const app = await getApp();
    const admin = await signupUser(app);
    const ws = admin.membership.workspaceId;
    const dept = await prisma.department.create({ data: { workspaceId: ws, name: 'Design' } });
    const orphan = await addMember(app, ws, { role: Role.member, departmentId: null });

    // Admin makes a workspace-wide board — orphan can edit
    const wsBoard = (await app.inject({
      method: 'POST',
      url: `/workspaces/${ws}/boards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'All hands' },
    })).json();
    const wsLists = (await app.inject({
      method: 'GET', url: `/boards/${wsBoard.id}`, headers: authHeader(admin.accessToken),
    })).json().lists;
    const c1 = await app.inject({
      method: 'POST', url: `/lists/${wsLists[0].id}/cards`,
      headers: authHeader(orphan.accessToken),
      payload: { title: 'Hi from no-dept' },
    });
    expect(c1.statusCode).toBe(201);

    // Admin makes a dept board — orphan cannot edit
    const deptBoard = (await app.inject({
      method: 'POST',
      url: `/workspaces/${ws}/boards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Design only', departmentId: dept.id },
    })).json();
    const deptLists = (await app.inject({
      method: 'GET', url: `/boards/${deptBoard.id}`, headers: authHeader(admin.accessToken),
    })).json().lists;
    const c2 = await app.inject({
      method: 'POST', url: `/lists/${deptLists[0].id}/cards`,
      headers: authHeader(orphan.accessToken),
      payload: { title: 'Should fail' },
    });
    expect(c2.statusCode).toBe(403);
  });

  it('completing a card increments the user KPIs', async () => {
    const { app, admin, dept } = await adminWithDept();
    const board = (await app.inject({
      method: 'POST',
      url: `/workspaces/${admin.membership.workspaceId}/boards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Tasks', departmentId: dept.id },
    })).json();
    const detail = (await app.inject({
      method: 'GET', url: `/boards/${board.id}`, headers: authHeader(admin.accessToken),
    })).json();
    const card = (await app.inject({
      method: 'POST',
      url: `/lists/${detail.lists[0].id}/cards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Ship demo' },
    })).json();
    // Make the actor a member of the card so it appears in their KPIs
    await app.inject({
      method: 'POST',
      url: `/cards/${card.id}/members`,
      headers: authHeader(admin.accessToken),
      payload: { userId: admin.id },
    });

    const before = (await app.inject({
      method: 'GET', url: `/users/${admin.id}/kpis`, headers: authHeader(admin.accessToken),
    })).json();
    expect(before.completedThisWeek).toBe(0);

    const complete = await app.inject({
      method: 'POST', url: `/cards/${card.id}/complete`,
      headers: authHeader(admin.accessToken),
    });
    expect(complete.statusCode).toBe(200);

    const after = (await app.inject({
      method: 'GET', url: `/users/${admin.id}/kpis`, headers: authHeader(admin.accessToken),
    })).json();
    expect(after.completedThisWeek).toBe(1);
    expect(after.activeCount).toBe(0);
  });

  // ── Department reassignment (claim a General board into a department) ──────
  // Rule: a General board can be moved into a department by its creator or a
  // dept_manager — but only into their OWN dept, one-way. Once it has a dept,
  // only an admin can move it again. Admins move freely.

  it('the creator can claim their General board into their own department', async () => {
    const app = await getApp();
    const admin = await signupUser(app);
    const ws = admin.membership.workspaceId;
    const dept = await prisma.department.create({ data: { workspaceId: ws, name: 'Engineering' } });
    // A dept_manager whose membership is in `dept`. They create a board — but
    // dept_managers auto-scope to their dept, so build a General board directly.
    const dm = await addMember(app, ws, { role: Role.dept_manager, departmentId: dept.id });
    const general = await prisma.board.create({
      data: { workspaceId: ws, title: 'Cross-team', departmentId: null, createdById: dm.id },
    });

    const move = await app.inject({
      method: 'PATCH', url: `/boards/${general.id}`,
      headers: authHeader(dm.accessToken),
      payload: { departmentId: dept.id },
    });
    expect(move.statusCode).toBe(200);
    expect(move.json().departmentId).toBe(dept.id);
  });

  it('cannot move a General board into a department that is not your own', async () => {
    const app = await getApp();
    const admin = await signupUser(app);
    const ws = admin.membership.workspaceId;
    const mine = await prisma.department.create({ data: { workspaceId: ws, name: 'Mine' } });
    const other = await prisma.department.create({ data: { workspaceId: ws, name: 'Other' } });
    const dm = await addMember(app, ws, { role: Role.dept_manager, departmentId: mine.id });
    const general = await prisma.board.create({
      data: { workspaceId: ws, title: 'Cross-team', departmentId: null, createdById: dm.id },
    });

    const move = await app.inject({
      method: 'PATCH', url: `/boards/${general.id}`,
      headers: authHeader(dm.accessToken),
      payload: { departmentId: other.id },
    });
    expect(move.statusCode).toBe(403);
  });

  it('once a board has a department, a non-admin manager cannot re-home it', async () => {
    const app = await getApp();
    const admin = await signupUser(app);
    const ws = admin.membership.workspaceId;
    const mine = await prisma.department.create({ data: { workspaceId: ws, name: 'Mine' } });
    const other = await prisma.department.create({ data: { workspaceId: ws, name: 'Other' } });
    const dm = await addMember(app, ws, { role: Role.dept_manager, departmentId: mine.id });
    const board = await prisma.board.create({
      data: { workspaceId: ws, title: 'Owned', departmentId: mine.id, createdById: dm.id },
    });

    // dept_manager manages this board (can rename) but must NOT move it elsewhere.
    const rename = await app.inject({
      method: 'PATCH', url: `/boards/${board.id}`,
      headers: authHeader(dm.accessToken),
      payload: { title: 'Owned v2' },
    });
    expect(rename.statusCode).toBe(200);

    const move = await app.inject({
      method: 'PATCH', url: `/boards/${board.id}`,
      headers: authHeader(dm.accessToken),
      payload: { departmentId: other.id },
    });
    expect(move.statusCode).toBe(403);
  });

  it('admin can move a board back to General', async () => {
    const { app, admin, dept } = await adminWithDept();
    const board = await prisma.board.create({
      data: { workspaceId: admin.membership.workspaceId, title: 'B', departmentId: dept.id, createdById: admin.id },
    });
    const move = await app.inject({
      method: 'PATCH', url: `/boards/${board.id}`,
      headers: authHeader(admin.accessToken),
      payload: { departmentId: null },
    });
    expect(move.statusCode).toBe(200);
    expect(move.json().departmentId).toBeNull();
  });

  it('a non-creator regular member cannot claim a General board', async () => {
    const app = await getApp();
    const admin = await signupUser(app);
    const ws = admin.membership.workspaceId;
    const dept = await prisma.department.create({ data: { workspaceId: ws, name: 'Dept' } });
    const member = await addMember(app, ws, { role: Role.member, departmentId: dept.id });
    const general = await prisma.board.create({
      data: { workspaceId: ws, title: 'Cross-team', departmentId: null, createdById: admin.id },
    });

    const move = await app.inject({
      method: 'PATCH', url: `/boards/${general.id}`,
      headers: authHeader(member.accessToken),
      payload: { departmentId: dept.id },
    });
    expect(move.statusCode).toBe(403);
  });

  it('a new card auto-assigns its creator as a member', async () => {
    const { app, admin, dept } = await adminWithDept();
    const boardId = (await app.inject({
      method: 'POST', url: `/workspaces/${admin.membership.workspaceId}/boards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Tracker', departmentId: dept.id },
    })).json().id;
    const board = (await app.inject({
      method: 'GET', url: `/boards/${boardId}`, headers: authHeader(admin.accessToken),
    })).json();

    const card = (await app.inject({
      method: 'POST', url: `/lists/${board.lists[0].id}/cards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'My task' },
    })).json();
    expect(card.memberIds).toContain(admin.id);

    // And it surfaces on the board fetch too.
    const after = (await app.inject({
      method: 'GET', url: `/boards/${boardId}`, headers: authHeader(admin.accessToken),
    })).json();
    const fetched = after.lists[0].cards.find((c: { id: string }) => c.id === card.id);
    expect(fetched.memberIds).toContain(admin.id);
  });
});
