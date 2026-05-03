import { describe, it, expect } from 'vitest';
import { Role } from '@prisma/client';
import { getApp, withCleanDb, signupUser, addMember, authHeader } from './helpers.js';
import { prisma } from '../src/db.js';

describe('department chat', () => {
  withCleanDb();

  it('@mentions create chat_mention notifications for the recipient', async () => {
    const app = await getApp();
    const admin = await signupUser(app);
    const dept = await prisma.department.create({
      data: { workspaceId: admin.membership.workspaceId, name: 'Design' },
    });
    const member = await addMember(app, admin.membership.workspaceId, {
      role: Role.member, departmentId: dept.id,
    });
    // Admin needs to be in the same dept to chat. Move them in.
    await prisma.membership.update({
      where: { id: admin.membership.id },
      data: { departmentId: dept.id },
    });

    const post = await app.inject({
      method: 'POST',
      url: `/departments/${dept.id}/chat/messages`,
      headers: authHeader(admin.accessToken),
      payload: { body: `hey @[Member](${member.id}), look at this` },
    });
    expect(post.statusCode).toBe(201);

    const notif = await app.inject({
      method: 'GET', url: '/me/notifications?limit=5',
      headers: authHeader(member.accessToken),
    });
    const list = notif.json().notifications;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].kind).toBe('chat_mention');
  });

  it('chat is scoped — outsider gets 403', async () => {
    const app = await getApp();
    const admin = await signupUser(app);
    const dept = await prisma.department.create({
      data: { workspaceId: admin.membership.workspaceId, name: 'Design' },
    });
    const otherDept = await prisma.department.create({
      data: { workspaceId: admin.membership.workspaceId, name: 'Marketing' },
    });
    const outsider = await addMember(app, admin.membership.workspaceId, {
      role: Role.member, departmentId: otherDept.id,
    });

    const list = await app.inject({
      method: 'GET',
      url: `/departments/${dept.id}/chat/messages`,
      headers: authHeader(outsider.accessToken),
    });
    expect(list.statusCode).toBe(403);
  });

  it('unread counter goes up for new messages and resets after marking read', async () => {
    const app = await getApp();
    const admin = await signupUser(app);
    const dept = await prisma.department.create({
      data: { workspaceId: admin.membership.workspaceId, name: 'Design' },
    });
    await prisma.membership.update({
      where: { id: admin.membership.id },
      data: { departmentId: dept.id },
    });
    const member = await addMember(app, admin.membership.workspaceId, {
      role: Role.member, departmentId: dept.id,
    });
    // Member marks as read first → empty counts
    await app.inject({
      method: 'POST',
      url: `/departments/${dept.id}/chat/read`,
      headers: authHeader(member.accessToken),
    });
    const before = (await app.inject({
      method: 'GET', url: '/me/chat-unread', headers: authHeader(member.accessToken),
    })).json();
    expect(before.counts[dept.id] || 0).toBe(0);

    // Admin posts → unread for member
    await app.inject({
      method: 'POST',
      url: `/departments/${dept.id}/chat/messages`,
      headers: authHeader(admin.accessToken),
      payload: { body: 'standup at 10' },
    });
    const after = (await app.inject({
      method: 'GET', url: '/me/chat-unread', headers: authHeader(member.accessToken),
    })).json();
    expect(after.counts[dept.id]).toBe(1);

    // Read again → cleared
    await app.inject({
      method: 'POST',
      url: `/departments/${dept.id}/chat/read`,
      headers: authHeader(member.accessToken),
    });
    const cleared = (await app.inject({
      method: 'GET', url: '/me/chat-unread', headers: authHeader(member.accessToken),
    })).json();
    expect(cleared.counts[dept.id] || 0).toBe(0);
  });
});
