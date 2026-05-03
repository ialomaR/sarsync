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
});
