// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the user-groups ticket)
// AI-Assisted Areas: acceptance tests for /api/groups — AT-1..AT-4, tenant isolation, permissions, audit, atomicity, idempotent membership, the deactivated-member design decision (SCRUM-149)
// Human Contributions: reviewed and approved by Alex Picard (PR #59, 2026-10-03); latest changes reviewed and approved by Mateus Silva (PR #60, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Each test states the requirement it proves. The rollback, race and last-admin-style guard tests were checked to fail when the behaviour they guard is removed. Reviewed before merge; see Human Contributions.

/**
 * Integration tests for user groups: create, read, rename, delete, and add/remove one member at a time
 * (SCRUM-149, AT-1..AT-4).
 *
 *  - **AT-1.** An admin creates a group and adds two members; the group lists both, and the audit log
 *    shows GROUP_CREATED plus one GROUP_MEMBER_ADDED per member.
 *  - **AT-2.** Adding a member from another organisation is a 404, never a 403 (SR-2) — the response
 *    cannot be used to confirm the id exists elsewhere — and the group is left unchanged.
 *  - **AT-3.** Every route, reads included, requires `groups:manage` (ORG_ADMIN only), the same shape
 *    as `/api/users`'s `GET /`.
 *  - **AT-4.** A group name is unique per organisation in any letter case; the same name is free again
 *    in a different organisation.
 *
 * Beyond the stated criteria, this file also proves the design notes' two answered open questions are
 * actually implemented: the feature is scoped to groups only (no loan-period fields exist anywhere
 * here), and a deactivated member is **not** removed from a group — membership is untouched — while
 * `isActiveMember()` (tested separately, in the unit suite) is what excludes them automatically.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../../src/app.js';
import { resetAuthRateLimiter } from '../../../src/middleware/rateLimit.js';
import { AuditEvent } from '../../../src/models/AuditEvent.js';
import { User } from '../../../src/models/User.js';
import { UserGroup } from '../../../src/models/UserGroup.js';
import * as assetRepo from '../../../src/repositories/asset.repository.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../../src/utils/constants.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

vi.mock('../../../src/repositories/auditEvent.repository.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, append: vi.fn(original.append) };
});

let seed;
beforeEach(async () => {
  resetAuthRateLimiter();
  seed = await seedTwoOrgs();
});

const asAdminA = () => accessCookieFor(seed.a.admin);
const create = (body, cookie = asAdminA()) =>
  request(app).post('/api/groups').set('Cookie', cookie).send(body);
const get = (groupId, cookie = asAdminA()) =>
  request(app).get(`/api/groups/${groupId}`).set('Cookie', cookie);
const list = (query = '', cookie = asAdminA()) =>
  request(app).get(`/api/groups${query}`).set('Cookie', cookie);
const patch = (groupId, body, cookie = asAdminA()) =>
  request(app).patch(`/api/groups/${groupId}`).set('Cookie', cookie).send(body);
const destroy = (groupId, cookie = asAdminA()) =>
  request(app).delete(`/api/groups/${groupId}`).set('Cookie', cookie).send({});
const addMember = (groupId, userId, cookie = asAdminA()) =>
  request(app).post(`/api/groups/${groupId}/members`).set('Cookie', cookie).send({ userId });
const removeMember = (groupId, userId, cookie = asAdminA()) =>
  request(app).delete(`/api/groups/${groupId}/members/${userId}`).set('Cookie', cookie).send({});

const auditFor = (orgId, action) => AuditEvent.find({ orgId, action }).lean();
/** A fresh group in org A, for tests that do not care about the creation step itself. */
const createGroup = async (name = 'Certified Drone Pilots') => (await create({ name })).body.group;

describe('POST /api/groups and POST /api/groups/:id/members (AT-1)', () => {
  it('creates a group, adds two members, and the group lists both', async () => {
    const created = await create({
      name: 'Certified Drone Pilots',
      description: 'Drone-rated staff',
    });
    expect(created.status).toBe(201);
    expect(created.body.group).toMatchObject({
      name: 'Certified Drone Pilots',
      description: 'Drone-rated staff',
      orgId: seed.a.orgId,
      memberIds: [],
      memberCount: 0,
    });
    const groupId = created.body.group.id;

    const addedDana = await addMember(groupId, seed.a.member._id);
    const addedLee = await addMember(groupId, seed.a.approver._id);
    expect(addedDana.status).toBe(200);
    expect(addedLee.status).toBe(200);

    const detail = await get(groupId);
    expect(detail.status).toBe(200);
    expect(detail.body.group.memberIds.sort()).toEqual(
      [String(seed.a.member._id), String(seed.a.approver._id)].sort(),
    );
    expect(detail.body.group.members.map((m) => m.email).sort()).toEqual(
      [seed.a.member.email, seed.a.approver.email].sort(),
    );

    const events = await auditFor(seed.a.orgId, AUDIT_ACTION.GROUP_CREATED);
    expect(events).toHaveLength(1);
    expect(String(events[0].targetId)).toBe(groupId);
    expect(events[0].targetType).toBe(AUDIT_TARGET_TYPE.UserGroup);
    const addedEvents = await auditFor(seed.a.orgId, AUDIT_ACTION.GROUP_MEMBER_ADDED);
    expect(addedEvents).toHaveLength(2);
    expect(addedEvents.map((e) => e.after.email).sort()).toEqual(
      [seed.a.member.email, seed.a.approver.email].sort(),
    );
  });

  it('never exposes nameLower, the internal comparison key', async () => {
    const res = await create({ name: 'Film Dept Staff' });
    expect(res.body.group.nameLower).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('nameLower');
  });

  it('defaults the description to an empty string', async () => {
    const res = await create({ name: 'No Description Given' });
    expect(res.body.group.description).toBe('');
  });

  it('rolls back the group when the audit write fails (OD-2)', async () => {
    auditRepo.append.mockRejectedValueOnce(new Error('simulated audit failure'));
    const before = await UserGroup.countDocuments({ orgId: seed.a.orgId });

    const failed = await create({ name: 'Should Not Exist' });

    expect(failed.status).toBe(500);
    expect(await UserGroup.countDocuments({ orgId: seed.a.orgId })).toBe(before);
    // Nothing half-created blocks a retry with the same name.
    expect((await create({ name: 'Should Not Exist' })).status).toBe(201);
  });

  it.each([
    ['a missing name', {}, 'name'],
    ['a blank name', { name: '   ' }, 'name'],
    ['a name over 120 characters', { name: 'x'.repeat(121) }, 'name'],
    ['an unknown field', { name: 'X', memberIds: ['a'.repeat(24)] }, null],
  ])('rejects %s with 400 and creates nothing', async (_label, body, field) => {
    const before = await UserGroup.countDocuments({ orgId: seed.a.orgId });
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    if (field) {
      expect(res.body.error.details.some((d) => d.path === field)).toBe(true);
    }
    expect(await UserGroup.countDocuments({ orgId: seed.a.orgId })).toBe(before);
  });
});

describe('POST /api/groups/:id/members (AT-2, tenant isolation)', () => {
  it('answers 404, never 403, for a member id from another organisation, and leaves the group unchanged', async () => {
    const group = await createGroup();

    const res = await addMember(group.id, seed.b.member._id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const stored = await UserGroup.findById(group.id);
    expect(stored.memberIds).toHaveLength(0);
  });

  it('answers 404 for a real group id that belongs to another organisation', async () => {
    const orgBGroup = await create({ name: 'Org B Only' }, accessCookieFor(seed.b.admin));
    expect(orgBGroup.status).toBe(201);

    const res = await addMember(orgBGroup.body.group.id, seed.a.member._id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const stored = await UserGroup.findById(orgBGroup.body.group.id);
    expect(stored.memberIds).toHaveLength(0);
  });

  it('answers 404 for a member id that exists nowhere, and 400 for something that is not an id', async () => {
    const group = await createGroup();
    expect((await addMember(group.id, '0'.repeat(24))).status).toBe(404);
    expect((await addMember(group.id, 'not-an-id')).status).toBe(400);
  });

  it('lets a member belong to several groups at once', async () => {
    const pilots = await createGroup('Certified Drone Pilots');
    const film = await createGroup('Film Dept Staff');
    await addMember(pilots.id, seed.a.member._id);
    await addMember(film.id, seed.a.member._id);

    expect((await get(pilots.id)).body.group.memberIds).toContain(String(seed.a.member._id));
    expect((await get(film.id)).body.group.memberIds).toContain(String(seed.a.member._id));
  });

  it('is idempotent: adding the same member twice changes nothing the second time and appends no second audit event', async () => {
    const group = await createGroup();
    const first = await addMember(group.id, seed.a.member._id);
    const second = await addMember(group.id, seed.a.member._id);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.group.memberIds).toEqual([String(seed.a.member._id)]);
    expect(await auditFor(seed.a.orgId, AUDIT_ACTION.GROUP_MEMBER_ADDED)).toHaveLength(1);
  });

  it('adds a deactivated member without complaint: membership is not blocked by deactivation', async () => {
    await User.collection.updateOne(
      { _id: seed.a.member._id },
      { $set: { deactivatedAt: new Date() } },
    );
    const group = await createGroup();

    const res = await addMember(group.id, seed.a.member._id);

    expect(res.status).toBe(200);
    expect(res.body.group.memberIds).toContain(String(seed.a.member._id));
  });

  it('rolls back the membership change when the audit write fails (OD-2)', async () => {
    const group = await createGroup();
    auditRepo.append.mockRejectedValueOnce(new Error('simulated audit failure'));

    const res = await addMember(group.id, seed.a.member._id);

    expect(res.status).toBe(500);
    const stored = await UserGroup.findById(group.id);
    expect(stored.memberIds).toHaveLength(0);
  });
});

describe('DELETE /api/groups/:id/members/:userId', () => {
  it('removes a member and appends GROUP_MEMBER_REMOVED', async () => {
    const group = await createGroup();
    await addMember(group.id, seed.a.member._id);

    const res = await removeMember(group.id, seed.a.member._id);

    expect(res.status).toBe(200);
    expect(res.body.group.memberIds).toHaveLength(0);
    const events = await auditFor(seed.a.orgId, AUDIT_ACTION.GROUP_MEMBER_REMOVED);
    expect(events).toHaveLength(1);
    expect(events[0].before).toEqual({ userId: String(seed.a.member._id) });
  });

  it('is a no-op, not a 404, for someone who was never a member', async () => {
    const group = await createGroup();
    const res = await removeMember(group.id, seed.a.member._id);
    expect(res.status).toBe(200);
    expect(await auditFor(seed.a.orgId, AUDIT_ACTION.GROUP_MEMBER_REMOVED)).toHaveLength(0);
  });

  it('is a no-op for an id that belongs to no user at all, rather than a 404', async () => {
    const group = await createGroup();
    const res = await removeMember(group.id, '0'.repeat(24));
    expect(res.status).toBe(200);
  });

  it('answers 404 for a group id from another organisation', async () => {
    const orgBGroup = await create({ name: 'Not Yours' }, accessCookieFor(seed.b.admin));
    const res = await removeMember(orgBGroup.body.group.id, seed.a.member._id);
    expect(res.status).toBe(404);
  });

  it('removing a deactivated member works the same as any other: deactivation does not change membership mechanics', async () => {
    const group = await createGroup();
    await addMember(group.id, seed.a.member._id);
    await User.collection.updateOne(
      { _id: seed.a.member._id },
      { $set: { deactivatedAt: new Date() } },
    );

    const res = await removeMember(group.id, seed.a.member._id);

    expect(res.status).toBe(200);
    expect(res.body.group.memberIds).toHaveLength(0);
  });
});

describe('GET /api/groups and GET /api/groups/:id', () => {
  it('lists the organisation’s groups, oldest first, and never another organisation’s', async () => {
    await create({ name: 'Group One' });
    await create({ name: 'Group Two' }, asAdminA());
    await create({ name: 'Org B Group' }, accessCookieFor(seed.b.admin));

    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((g) => g.name)).toEqual(['Group One', 'Group Two']);
    expect(res.body.items.every((g) => g.orgId === seed.a.orgId)).toBe(true);
  });

  it('paginates the list', async () => {
    await create({ name: 'A' });
    await create({ name: 'B' });
    await create({ name: 'C' });

    const page1 = await list('?limit=2');
    const page2 = await list('?limit=2&page=2');

    expect(page1.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(1);
  });

  it('answers 404 for a group id from another organisation', async () => {
    const orgBGroup = await create({ name: 'Not Yours' }, accessCookieFor(seed.b.admin));
    const res = await get(orgBGroup.body.group.id);
    expect(res.status).toBe(404);
  });

  it('shows a deactivated member’s status alongside the others, rather than hiding them', async () => {
    const group = await createGroup();
    const added = await addMember(group.id, seed.a.member._id);
    expect(added.status).toBe(200);
    await User.collection.updateOne(
      { _id: seed.a.member._id },
      { $set: { deactivatedAt: new Date('2026-01-01') } },
    );

    const detail = await get(group.id);

    const member = detail.body.group.members.find((m) => m.id === String(seed.a.member._id));
    expect(member.deactivatedAt).not.toBeNull();
  });
});

/**
 * SCRUM-204: a group's page names the equipment it restricts, and flags the assets for which it is the
 * only listed group — deleting it would leave those requestable by nobody.
 */
describe('GET /api/groups/:id — restrictedAssets (SCRUM-204)', () => {
  it('lists the assets restricted to the group, flagging where it is the only group', async () => {
    const pilots = await createGroup('Certified Drone Pilots');
    const heavy = await createGroup('Heavy Machinery Certified');
    const [laptop, camera] = [seed.a.asset, seed.a.extraAssets[0].asset];
    await assetRepo.update(seed.a.orgId, laptop._id, { allowedGroupIds: [pilots.id] });
    await assetRepo.update(seed.a.orgId, camera._id, { allowedGroupIds: [pilots.id, heavy.id] });

    const res = await get(pilots.id);

    expect(res.status).toBe(200);
    expect(res.body.group.restrictedAssets).toEqual(
      expect.arrayContaining([
        { id: String(laptop._id), name: laptop.name, onlyGroup: true },
        { id: String(camera._id), name: camera.name, onlyGroup: false },
      ]),
    );
    expect(res.body.group.restrictedAssets).toHaveLength(2);
  });

  it('leaves out retired assets, which nobody can request anyway', async () => {
    const pilots = await createGroup();
    await assetRepo.update(seed.a.orgId, seed.a.asset._id, { allowedGroupIds: [pilots.id] });
    await assetRepo.retire(seed.a.orgId, seed.a.asset._id);

    const res = await get(pilots.id);

    expect(res.body.group.restrictedAssets).toEqual([]);
  });

  it('never lists another organisation’s asset, even one pointing at this group id', async () => {
    const pilots = await createGroup();
    // Not reachable through the API (AT-5 refuses it); written directly to prove the read is scoped.
    await assetRepo.update(seed.b.orgId, seed.b.asset._id, { allowedGroupIds: [pilots.id] });

    const res = await get(pilots.id);

    expect(res.body.group.restrictedAssets).toEqual([]);
  });
});

describe('PATCH /api/groups/:id', () => {
  it('renames a group and appends GROUP_UPDATED with before/after', async () => {
    const group = await createGroup('Old Name');

    const res = await patch(group.id, { name: 'New Name', description: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.group).toMatchObject({ name: 'New Name', description: 'Updated' });
    const events = await auditFor(seed.a.orgId, AUDIT_ACTION.GROUP_UPDATED);
    expect(events).toHaveLength(1);
    expect(events[0].before).toEqual({ name: 'Old Name', description: '' });
    expect(events[0].after).toEqual({ name: 'New Name', description: 'Updated' });
  });

  it('is a no-op with no audit event when the patch matches what is already stored', async () => {
    const group = await createGroup('Same Name');
    const res = await patch(group.id, { name: 'Same Name' });
    expect(res.status).toBe(200);
    expect(await auditFor(seed.a.orgId, AUDIT_ACTION.GROUP_UPDATED)).toHaveLength(0);
  });

  it('refuses to rename to a name another group in the organisation already has, in any letter case (AT-4)', async () => {
    await create({ name: 'Film Dept Staff' });
    const group = await createGroup('Something Else');

    const res = await patch(group.id, { name: 'FILM DEPT STAFF' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await UserGroup.findById(group.id)).name).toBe('Something Else');
  });

  it('allows renaming a group to the name it already has in different casing (no real change)', async () => {
    const group = await createGroup('Same Group');
    const res = await patch(group.id, { name: 'same group' });
    expect(res.status).toBe(200);
  });

  it('answers 404 for a group id from another organisation', async () => {
    const orgBGroup = await create({ name: 'Not Yours' }, accessCookieFor(seed.b.admin));
    const res = await patch(orgBGroup.body.group.id, { name: 'Hijacked' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/groups/:id', () => {
  it('deletes the group and appends GROUP_DELETED with a before snapshot including its members', async () => {
    const group = await createGroup('To Be Deleted');
    await addMember(group.id, seed.a.member._id);

    const res = await destroy(group.id);

    expect(res.status).toBe(204);
    expect(await UserGroup.findById(group.id)).toBeNull();
    const events = await auditFor(seed.a.orgId, AUDIT_ACTION.GROUP_DELETED);
    expect(events).toHaveLength(1);
    expect(events[0].before).toMatchObject({
      name: 'To Be Deleted',
      memberIds: [String(seed.a.member._id)],
    });
    expect(events[0].after).toBeNull();
  });

  it('answers 404 for a group id from another organisation, and leaves it untouched', async () => {
    const orgBGroup = await create({ name: 'Not Yours' }, accessCookieFor(seed.b.admin));
    const res = await destroy(orgBGroup.body.group.id);
    expect(res.status).toBe(404);
    expect(await UserGroup.findById(orgBGroup.body.group.id)).not.toBeNull();
  });

  it('answers 404 for an id that exists nowhere, and 400 for something that is not an id', async () => {
    expect((await destroy('0'.repeat(24))).status).toBe(404);
    expect((await destroy('not-an-id')).status).toBe(400);
  });
});

describe('AT-3: only ORG_ADMIN may use any /api/groups route', () => {
  it.each([
    ['an APPROVER', () => accessCookieFor(seed.a.approver)],
    ['a MEMBER', () => accessCookieFor(seed.a.member)],
  ])('is forbidden to %s for both reads and writes', async (_label, cookie) => {
    const group = await createGroup();
    const asOther = cookie();

    for (const res of [
      await list('', asOther),
      await create({ name: 'Should Not Exist' }, asOther),
      await get(group.id, asOther),
      await patch(group.id, { name: 'Hijacked' }, asOther),
      await addMember(group.id, seed.a.member._id, asOther),
      await removeMember(group.id, seed.a.member._id, asOther),
      await destroy(group.id, asOther),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    // Nothing above actually took effect.
    expect(await UserGroup.findById(group.id)).not.toBeNull();
  });

  it('requires authentication on every route', async () => {
    const group = await createGroup();
    for (const res of [
      await request(app).get('/api/groups'),
      await request(app).post('/api/groups').send({ name: 'X' }),
      await request(app).get(`/api/groups/${group.id}`),
    ]) {
      expect(res.status).toBe(401);
    }
  });
});

describe('AT-4: group names are unique per organisation', () => {
  it('refuses a second group with the same name, in any letter case, within the organisation', async () => {
    await create({ name: 'Film Dept Staff' });
    const res = await create({ name: 'FILM dept STAFF' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await UserGroup.countDocuments({ orgId: seed.a.orgId })).toBe(1);
  });

  it('allows the same name in a different organisation', async () => {
    await create({ name: 'Film Dept Staff' });
    const res = await create({ name: 'Film Dept Staff' }, accessCookieFor(seed.b.admin));
    expect(res.status).toBe(201);
  });

  it('gives exactly one of two simultaneous creates with the same name a 201, and the other a 409', async () => {
    const [one, two] = await Promise.all([
      create({ name: 'Race Condition' }),
      create({ name: 'Race Condition' }),
    ]);
    expect([one.status, two.status].sort()).toEqual([201, 409]);
    expect(
      await UserGroup.countDocuments({ orgId: seed.a.orgId, nameLower: 'race condition' }),
    ).toBe(1);
  });
});
