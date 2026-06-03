import { describe, it, expect } from 'vitest';
import { Role } from '@prisma/client';
import { getApp, withCleanDb, signupUser, addMember, authHeader } from './helpers.js';
import { prisma } from '../src/db.js';

describe('custom board fields', () => {
  withCleanDb();

  // Make an admin + a board (with default lists) + a card on the first list.
  async function adminBoardWithCard() {
    const app = await getApp();
    const admin = await signupUser(app);
    const ws = admin.membership.workspaceId;
    const create = await app.inject({
      method: 'POST', url: `/workspaces/${ws}/boards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Maintenance' },
    });
    const boardId = create.json().id;
    const board = (await app.inject({
      method: 'GET', url: `/boards/${boardId}`, headers: authHeader(admin.accessToken),
    })).json();
    const listId = board.lists[0].id;
    const card = (await app.inject({
      method: 'POST', url: `/lists/${listId}/cards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Marble repair' },
    })).json();
    return { app, admin, ws, boardId, listId, cardId: card.id };
  }

  it('legacy board with no fields returns an empty fields array', async () => {
    const { app, admin, boardId } = await adminBoardWithCard();
    const board = (await app.inject({
      method: 'GET', url: `/boards/${boardId}`, headers: authHeader(admin.accessToken),
    })).json();
    expect(board.fields).toEqual([]);
    expect(board.lists[0].cards[0].fieldValues).toEqual([]);
  });

  it('create a text field, set a card value, and read it back on the board', async () => {
    const { app, admin, boardId, cardId } = await adminBoardWithCard();

    const field = (await app.inject({
      method: 'POST', url: `/boards/${boardId}/fields`,
      headers: authHeader(admin.accessToken),
      payload: { name: 'Action taken', type: 'text' },
    })).json();
    expect(field.type).toBe('text');

    const set = await app.inject({
      method: 'PUT', url: `/cards/${cardId}/fields/${field.id}`,
      headers: authHeader(admin.accessToken),
      payload: { text: 'Contacted contractor' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().valueText).toBe('Contacted contractor');

    const board = (await app.inject({
      method: 'GET', url: `/boards/${boardId}`, headers: authHeader(admin.accessToken),
    })).json();
    expect(board.fields.map((f: { id: string }) => f.id)).toContain(field.id);
    const fv = board.lists[0].cards[0].fieldValues.find((v: { fieldId: string }) => v.fieldId === field.id);
    expect(fv.valueText).toBe('Contacted contractor');
  });

  it('select field rejects an unknown option but accepts a valid one', async () => {
    const { app, admin, boardId, cardId } = await adminBoardWithCard();
    const field = (await app.inject({
      method: 'POST', url: `/boards/${boardId}/fields`,
      headers: authHeader(admin.accessToken),
      payload: {
        name: 'Status', type: 'select',
        options: [{ id: 'o-todo', label: 'To do' }, { id: 'o-done', label: 'Done' }],
      },
    })).json();

    const bad = await app.inject({
      method: 'PUT', url: `/cards/${cardId}/fields/${field.id}`,
      headers: authHeader(admin.accessToken),
      payload: { optionId: 'o-nope' },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PUT', url: `/cards/${cardId}/fields/${field.id}`,
      headers: authHeader(admin.accessToken),
      payload: { optionId: 'o-done' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().valueOptionId).toBe('o-done');
  });

  it('deleting a field cascades its values off the cards', async () => {
    const { app, admin, boardId, cardId } = await adminBoardWithCard();
    const field = (await app.inject({
      method: 'POST', url: `/boards/${boardId}/fields`,
      headers: authHeader(admin.accessToken),
      payload: { name: 'Note', type: 'text' },
    })).json();
    await app.inject({
      method: 'PUT', url: `/cards/${cardId}/fields/${field.id}`,
      headers: authHeader(admin.accessToken), payload: { text: 'x' },
    });

    const del = await app.inject({
      method: 'DELETE', url: `/fields/${field.id}`, headers: authHeader(admin.accessToken),
    });
    expect(del.statusCode).toBe(204);
    expect(await prisma.cardFieldValue.count({ where: { fieldId: field.id } })).toBe(0);

    const board = (await app.inject({
      method: 'GET', url: `/boards/${boardId}`, headers: authHeader(admin.accessToken),
    })).json();
    expect(board.fields).toEqual([]);
  });

  it('a person field value surfaces the user in peopleById', async () => {
    const { app, admin, ws, boardId, cardId } = await adminBoardWithCard();
    const mate = await addMember(app, ws, { role: Role.member, firstName: 'Sara' });
    const field = (await app.inject({
      method: 'POST', url: `/boards/${boardId}/fields`,
      headers: authHeader(admin.accessToken),
      payload: { name: 'Owner', type: 'person' },
    })).json();
    await app.inject({
      method: 'PUT', url: `/cards/${cardId}/fields/${field.id}`,
      headers: authHeader(admin.accessToken), payload: { userId: mate.id },
    });

    const board = (await app.inject({
      method: 'GET', url: `/boards/${boardId}`, headers: authHeader(admin.accessToken),
    })).json();
    expect(board.peopleById[mate.id]).toBeTruthy();
  });

  it('a member from another department cannot define fields on a dept board', async () => {
    const app = await getApp();
    const admin = await signupUser(app);
    const ws = admin.membership.workspaceId;
    const deptA = await prisma.department.create({ data: { workspaceId: ws, name: 'A' } });
    const deptB = await prisma.department.create({ data: { workspaceId: ws, name: 'B' } });
    const boardId = (await app.inject({
      method: 'POST', url: `/workspaces/${ws}/boards`,
      headers: authHeader(admin.accessToken),
      payload: { title: 'Dept A board', departmentId: deptA.id },
    })).json().id;
    const outsider = await addMember(app, ws, { role: Role.member, departmentId: deptB.id });

    const res = await app.inject({
      method: 'POST', url: `/boards/${boardId}/fields`,
      headers: authHeader(outsider.accessToken),
      payload: { name: 'Sneaky', type: 'text' },
    });
    expect(res.statusCode).toBe(403);
  });
});
