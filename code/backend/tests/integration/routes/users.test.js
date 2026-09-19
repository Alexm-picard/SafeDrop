// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: acceptance tests for GET /api/users, POST /api/users/invite, PATCH /api/users/:id/role — permissions, tenant isolation, audit, atomicity, last-admin rule, concurrency
// Human Contributions: pending team review
// Notes: Each test states the requirement it proves. The two rollback tests and the mutual-demotion test were checked to fail when the behaviour they guard is removed. Must be reviewed by the owning team member before merge.

/**
 * Integration tests for member lifecycle: list, invite, change role (SDD OD-3, SR-1, SR-2, OD-2).
 *
 * The point of the ticket is that an organisation can have more than one person in it: the end-to-end
 * test at the bottom has an admin add an approver and a member, who then sign in with the passwords they
 * were given and find the access their role implies. Around it are the properties that make the routes
 * safe:
 *  - **Only ORG_ADMIN** can use any of it, and a *demoted* admin holding an unexpired token is refused,
 *    because the mutations re-read the role from the database (SDD §6.2).
 *  - **Tenant isolation.** An invitation lands in the caller's organisation whatever the body says; a
 *    user from another organisation is a 404, never a 403 (SR-2).
 *  - **Audit.** USER_INVITED and USER_ROLE_CHANGED are appended in the same transaction as the change,
 *    so if the audit write fails nothing is left behind (OD-2) — including a demotion's session
 *    revocation.
 *  - **The last ORG_ADMIN cannot be demoted**, including when two admins try to demote each other at
 *    the same instant, which a naive count-then-write would let both win.
 *  - **Credentials.** Iteration 1 has no email service, so the admin sets the member's initial password
 *    and shares it out of band. It is validated like any password, stored only as a bcrypt hash, and
 *    never returned, logged or audited.
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../../src/app.js';
import { resetAuthRateLimiter } from '../../../src/middleware/rateLimit.js';
import { AuditEvent } from '../../../src/models/AuditEvent.js';
import { RefreshToken } from '../../../src/models/RefreshToken.js';
import { User } from '../../../src/models/User.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import * as userRepo from '../../../src/repositories/user.repository.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../../src/utils/constants.js';
import { ROLES } from '../../../src/utils/permissions.js';
import { accessCookieFor, loginAs } from '../../helpers/authAs.js';
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
/** The initial password an admin sets in these tests unless a test says otherwise. */
const INITIAL_PASSWORD = 'Initial-Passw0rd-1';
/** Send `body` exactly as given: for tests about a missing or invalid password. */
const inviteRaw = (body, cookie = asAdminA()) =>
  request(app).post('/api/users/invite').set('Cookie', cookie).send(body);
/** Invite with a valid initial password unless the body names one. */
const invite = (body, cookie = asAdminA()) =>
  inviteRaw({ password: INITIAL_PASSWORD, ...body }, cookie);
const changeRole = (userId, role, cookie = asAdminA()) =>
  request(app).patch(`/api/users/${userId}/role`).set('Cookie', cookie).send({ role });
const listUsers = (query = '', cookie = asAdminA()) =>
  request(app).get(`/api/users${query}`).set('Cookie', cookie);

const newMember = { email: 'new.hire@a.test', name: 'New Hire' };
/** The exact set of fields a member may be shown as: no hash, nothing internal. */
const PUBLIC_USER_FIELDS = ['createdAt', 'email', 'id', 'name', 'orgId', 'role'];

const auditFor = (orgId, action) => AuditEvent.find({ orgId, action }).lean();
const adminCount = (orgId) => User.countDocuments({ orgId, role: ROLES.ORG_ADMIN });

describe('POST /api/users/invite', () => {
  it('creates a MEMBER in the admin’s organisation and returns the member, never the password', async () => {
    const res = await invite(newMember);

    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['user']);
    expect(Object.keys(res.body.user).sort()).toEqual(PUBLIC_USER_FIELDS);
    expect(res.body.user).toMatchObject({
      email: 'new.hire@a.test',
      name: 'New Hire',
      role: ROLES.MEMBER,
      orgId: seed.a.orgId,
    });
    // The password the admin set is not echoed back, in any form.
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);
  });

  it('stores only a bcrypt hash of the initial password the admin set', async () => {
    await invite(newMember);
    const stored = await User.findOne({ orgId: seed.a.orgId, email: newMember.email }).select(
      '+passwordHash',
    );

    expect(stored.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(stored.passwordHash).not.toContain(INITIAL_PASSWORD);
    expect(await bcrypt.compare(INITIAL_PASSWORD, stored.passwordHash)).toBe(true);
  });

  it('lets the new member sign in with the password they were given', async () => {
    await invite(newMember);
    const { res } = await loginAs(app, {
      orgSlug: 'org-a',
      email: newMember.email,
      password: INITIAL_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: newMember.email, role: ROLES.MEMBER });
    // A different password does not.
    const wrong = await loginAs(app, {
      orgSlug: 'org-a',
      email: newMember.email,
      password: 'Some-Other-Passw0rd',
    });
    expect(wrong.res.status).toBe(401);
  });

  it('gives each member their own salted hash, even for the same password', async () => {
    await invite(newMember);
    await invite({ email: 'second@a.test', name: 'Second' });
    const hashOf = async (email) =>
      (await User.findOne({ orgId: seed.a.orgId, email }).select('+passwordHash')).passwordHash;
    expect(await hashOf(newMember.email)).not.toBe(await hashOf('second@a.test'));
  });

  it.each([
    ['passwordHash', { passwordHash: '$2b$12$abcdefghijklmnopqrstuv' }],
    ['temporaryPassword', { temporaryPassword: 'Another-Passw0rd-1' }],
    ['id', { id: '0'.repeat(24) }],
  ])('rejects a client-supplied %s field with 400 (mass assignment)', async (_name, extra) => {
    const before = await User.countDocuments({ orgId: seed.a.orgId });
    const res = await invite({ ...newMember, ...extra });
    expect(res.status).toBe(400);
    expect(await User.countDocuments({ orgId: seed.a.orgId })).toBe(before);
  });

  it('honours a requested role, including ORG_ADMIN, and normalises the email', async () => {
    const res = await invite({
      email: '  Lead.Approver@A.Test ',
      name: 'Lead Approver',
      role: ROLES.APPROVER,
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'lead.approver@a.test', role: ROLES.APPROVER });

    const admin = await invite({
      email: 'second.admin@a.test',
      name: 'Second Admin',
      role: 'ORG_ADMIN',
    });
    expect(admin.status).toBe(201);
    expect(admin.body.user.role).toBe(ROLES.ORG_ADMIN);
  });

  it('appends USER_INVITED in the same organisation, naming the admin, without any credential', async () => {
    const res = await invite(newMember);
    const events = await auditFor(seed.a.orgId, AUDIT_ACTION.USER_INVITED);

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(String(event.actorId)).toBe(String(seed.a.admin._id));
    expect(event.actorRole).toBe(ROLES.ORG_ADMIN);
    expect(event.targetType).toBe(AUDIT_TARGET_TYPE.User);
    expect(String(event.targetId)).toBe(res.body.user.id);
    expect(event.before).toBeNull();
    expect(event.after).toMatchObject({
      email: 'new.hire@a.test',
      name: 'New Hire',
      role: ROLES.MEMBER,
    });
    // The audit trail is readable by every admin and kept forever: it must not hold a credential.
    expect(JSON.stringify(event)).not.toMatch(/password|hash/i);
    expect(JSON.stringify(event)).not.toContain(INITIAL_PASSWORD);
    // And no other organisation's trail was touched.
    expect(await auditFor(seed.b.orgId, AUDIT_ACTION.USER_INVITED)).toHaveLength(0);
  });

  it('cannot be aimed at another organisation: an orgId in the body is ignored (SR-2)', async () => {
    const res = await invite({ ...newMember, orgId: seed.b.orgId });

    expect(res.status).toBe(201);
    expect(res.body.user.orgId).toBe(seed.a.orgId);
    expect(await User.countDocuments({ orgId: seed.b.orgId, email: newMember.email })).toBe(0);
    expect(await User.countDocuments({ orgId: seed.a.orgId, email: newMember.email })).toBe(1);
  });

  it('refuses an email that is already a member of the organisation with 409, in any letter case', async () => {
    const before = await User.countDocuments({ orgId: seed.a.orgId });
    const res = await invite({ email: ` ${seed.a.member.email.toUpperCase()} `, name: 'Dup' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({ field: 'email' });
    expect(await User.countDocuments({ orgId: seed.a.orgId })).toBe(before);
    expect(await auditFor(seed.a.orgId, AUDIT_ACTION.USER_INVITED)).toHaveLength(0);
  });

  it('allows an email that exists in a different organisation: uniqueness is per organisation (OD-3)', async () => {
    const res = await invite({ email: seed.b.member.email, name: 'Also In B' });
    expect(res.status).toBe(201);
    expect(res.body.user.orgId).toBe(seed.a.orgId);
  });

  it('gives exactly one of two simultaneous invitations for the same email a 201, and the other a 409', async () => {
    const [one, two] = await Promise.all([invite(newMember), invite(newMember)]);

    expect([one.status, two.status].sort()).toEqual([201, 409]);
    expect(await User.countDocuments({ orgId: seed.a.orgId, email: newMember.email })).toBe(1);
    expect(await auditFor(seed.a.orgId, AUDIT_ACTION.USER_INVITED)).toHaveLength(1);
  });

  it.each([
    ['a missing email', { name: 'X' }, 'email'],
    ['a malformed email', { email: 'not-an-email', name: 'X' }, 'email'],
    ['a missing name', { email: 'x@a.test' }, 'name'],
    ['a blank name', { email: 'x@a.test', name: '   ' }, 'name'],
    ['an unknown role', { email: 'x@a.test', name: 'X', role: 'SUPERUSER' }, 'role'],
    ['a lower-case role', { email: 'x@a.test', name: 'X', role: 'org_admin' }, 'role'],
    ['a missing password', { email: 'x@a.test', name: 'X', password: undefined }, 'password'],
    ['a too-short password', { email: 'x@a.test', name: 'X', password: 'short' }, 'password'],
    [
      'a password over bcrypt’s 72-byte limit',
      { email: 'x@a.test', name: 'X', password: 'a'.repeat(73) },
      'password',
    ],
    ['a non-string password', { email: 'x@a.test', name: 'X', password: 12345678901 }, 'password'],
    [
      'an operator in place of a password',
      { email: 'x@a.test', name: 'X', password: { $ne: null } },
      null,
    ],
  ])('rejects %s with 400 and creates nothing', async (_label, body, field) => {
    const before = await User.countDocuments({ orgId: seed.a.orgId });
    const res = await inviteRaw({ password: INITIAL_PASSWORD, ...body });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    if (field) {
      expect(res.body.error.details.some((d) => d.path === field)).toBe(true);
    }
    expect(await User.countDocuments({ orgId: seed.a.orgId })).toBe(before);
  });

  it('leaves no user behind when the audit write fails (OD-2)', async () => {
    auditRepo.append.mockRejectedValueOnce(new Error('simulated audit failure'));
    const before = await User.countDocuments({ orgId: seed.a.orgId });

    const failed = await invite(newMember);
    expect(failed.status).toBe(500);
    expect(await User.countDocuments({ orgId: seed.a.orgId })).toBe(before);

    // Nothing half-created blocks a retry.
    const retried = await invite(newMember);
    expect(retried.status).toBe(201);
  });

  it.each([
    ['an APPROVER', () => accessCookieFor(seed.a.approver)],
    ['a MEMBER', () => accessCookieFor(seed.a.member)],
  ])('is forbidden to %s (users:manage)', async (_label, cookie) => {
    const before = await User.countDocuments({ orgId: seed.a.orgId });
    const res = await invite(newMember, cookie());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await User.countDocuments({ orgId: seed.a.orgId })).toBe(before);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/users/invite').send(newMember);
    expect(res.status).toBe(401);
  });

  it('refuses an admin who has been demoted since their token was issued (SDD §6.2)', async () => {
    // The token still says ORG_ADMIN — it is valid for up to 15 minutes — but the database says MEMBER.
    const staleToken = accessCookieFor({ ...seed.a.admin.toObject(), role: ROLES.ORG_ADMIN });
    await userRepo.updateRole(seed.a.orgId, seed.a.admin._id, ROLES.MEMBER);

    const before = await User.countDocuments({ orgId: seed.a.orgId });
    const res = await invite(newMember, staleToken);

    expect(res.status).toBe(403);
    expect(await User.countDocuments({ orgId: seed.a.orgId })).toBe(before);
  });
});

describe('GET /api/users', () => {
  it('lists the organisation’s members with public fields only, and never another organisation’s', async () => {
    const res = await listUsers();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, page: 1, limit: 25 });
    expect(res.body.items).toHaveLength(3);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(PUBLIC_USER_FIELDS);
      expect(item.orgId).toBe(seed.a.orgId);
    }
    expect(res.body.items.map((u) => u.email).sort()).toEqual([
      'admin@a.test',
      'approver@a.test',
      'member@a.test',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|@b\.test/);
  });

  it('shows a newly invited member, after the existing ones (oldest first)', async () => {
    const invited = await invite(newMember);
    const res = await listUsers();

    expect(res.body.total).toBe(4);
    expect(res.body.items.at(-1).id).toBe(invited.body.user.id);
  });

  it('pages through the list', async () => {
    const first = await listUsers('?limit=2');
    const second = await listUsers('?limit=2&page=2');

    expect(first.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(first.body.items).toHaveLength(2);
    expect(second.body).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(second.body.items).toHaveLength(1);
    const ids = [...first.body.items, ...second.body.items].map((u) => u.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('sees only its own members from the other organisation’s side too', async () => {
    const res = await listUsers('', accessCookieFor(seed.b.admin));
    expect(res.body.total).toBe(3);
    expect(res.body.items.every((u) => u.orgId === seed.b.orgId)).toBe(true);
  });

  it('ignores an orgId in the query string (SR-2)', async () => {
    const res = await listUsers(`?orgId=${seed.b.orgId}`);
    expect(res.status).toBe(200);
    expect(res.body.items.every((u) => u.orgId === seed.a.orgId)).toBe(true);
  });

  it.each(['?page=0', '?limit=0', '?limit=101', '?page=abc', '?page[$gt]=0'])(
    'rejects %s with 400',
    async (query) => {
      const res = await listUsers(query);
      expect(res.status).toBe(400);
    },
  );

  it.each([
    ['an APPROVER', () => accessCookieFor(seed.a.approver)],
    ['a MEMBER', () => accessCookieFor(seed.a.member)],
  ])('is forbidden to %s (users:manage)', async (_label, cookie) => {
    const res = await listUsers('', cookie());
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('changes the role and appends USER_ROLE_CHANGED with before and after', async () => {
    const res = await changeRole(seed.a.member._id, ROLES.APPROVER);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.user).sort()).toEqual(PUBLIC_USER_FIELDS);
    expect(res.body.user).toMatchObject({ id: String(seed.a.member._id), role: ROLES.APPROVER });
    expect(await userRepo.findRole(seed.a.orgId, seed.a.member._id)).toBe(ROLES.APPROVER);

    const events = await auditFor(seed.a.orgId, AUDIT_ACTION.USER_ROLE_CHANGED);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(String(event.actorId)).toBe(String(seed.a.admin._id));
    expect(event.actorRole).toBe(ROLES.ORG_ADMIN);
    expect(event.targetType).toBe(AUDIT_TARGET_TYPE.User);
    expect(String(event.targetId)).toBe(String(seed.a.member._id));
    expect(event.before).toEqual({ role: ROLES.MEMBER });
    expect(event.after).toEqual({ role: ROLES.APPROVER });
  });

  it('gives the promoted user the new role at their next sign-in and refresh', async () => {
    const before = await loginAs(app, {
      orgSlug: 'org-a',
      email: seed.a.member.email,
      password: seed.password,
    });
    await changeRole(seed.a.member._id, ROLES.APPROVER);

    // A promotion does not end their session; the next refresh re-reads the role.
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', before.refreshCookie)
      .send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.role).toBe(ROLES.APPROVER);
  });

  it('a demotion ends the demoted user’s sessions', async () => {
    const approver = await loginAs(app, {
      orgSlug: 'org-a',
      email: seed.a.approver.email,
      password: seed.password,
    });
    expect(
      await RefreshToken.countDocuments({ userId: seed.a.approver._id, revokedAt: null }),
    ).toBe(1);

    const res = await changeRole(seed.a.approver._id, ROLES.MEMBER);
    expect(res.status).toBe(200);

    expect(
      await RefreshToken.countDocuments({ userId: seed.a.approver._id, revokedAt: null }),
    ).toBe(0);
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', approver.refreshCookie)
      .send({});
    expect(refresh.status).toBe(401);
  });

  it('setting the role a member already holds is a 200 no-op with no audit event', async () => {
    const res = await changeRole(seed.a.member._id, ROLES.MEMBER);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe(ROLES.MEMBER);
    expect(await auditFor(seed.a.orgId, AUDIT_ACTION.USER_ROLE_CHANGED)).toHaveLength(0);
  });

  it('can change only the role: any other field in the body is a 400 and nothing changes', async () => {
    // Validation is strict, so this route cannot be turned into a way to edit anything else.
    const res = await request(app)
      .patch(`/api/users/${seed.a.member._id}/role`)
      .set('Cookie', asAdminA())
      .send({ role: ROLES.APPROVER, email: 'hijack@a.test', name: 'Hijacked' });

    expect(res.status).toBe(400);
    const stored = await User.findById(seed.a.member._id);
    expect(stored).toMatchObject({
      email: seed.a.member.email,
      name: seed.a.member.name,
      role: ROLES.MEMBER,
    });
  });

  it('ignores an orgId in the body: the tenant comes from the token (SR-2)', async () => {
    const res = await request(app)
      .patch(`/api/users/${seed.a.member._id}/role`)
      .set('Cookie', asAdminA())
      .send({ role: ROLES.APPROVER, orgId: seed.b.orgId });

    expect(res.status).toBe(200);
    expect(String((await User.findById(seed.a.member._id)).orgId)).toBe(seed.a.orgId);
    expect(await userRepo.findRole(seed.b.orgId, seed.b.member._id)).toBe(ROLES.MEMBER);
  });

  describe('the last ORG_ADMIN', () => {
    it('cannot be demoted, even by themselves: 409 and nothing changes', async () => {
      const res = await changeRole(seed.a.admin._id, ROLES.MEMBER);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(await userRepo.findRole(seed.a.orgId, seed.a.admin._id)).toBe(ROLES.ORG_ADMIN);
      expect(await auditFor(seed.a.orgId, AUDIT_ACTION.USER_ROLE_CHANGED)).toHaveLength(0);
    });

    it('can be demoted once another admin exists, and is then protected in turn', async () => {
      const promote = await changeRole(seed.a.member._id, ROLES.ORG_ADMIN);
      expect(promote.status).toBe(200);
      expect(await adminCount(seed.a.orgId)).toBe(2);

      // The original admin steps down. Two admins existed, so this is allowed…
      const stepDown = await changeRole(seed.a.admin._id, ROLES.MEMBER);
      expect(stepDown.status).toBe(200);
      expect(await adminCount(seed.a.orgId)).toBe(1);

      // …and the one who remains cannot be removed by their own hand.
      const newAdmin = accessCookieFor({ ...seed.a.member.toObject(), role: ROLES.ORG_ADMIN });
      const refused = await changeRole(seed.a.member._id, ROLES.MEMBER, newAdmin);
      expect(refused.status).toBe(409);
      expect(await adminCount(seed.a.orgId)).toBe(1);
    });

    it('survives two admins demoting each other at the same instant', async () => {
      // With two admins, each request on its own is legal. Done concurrently, a count-then-write
      // would let both succeed and leave the organisation with nobody able to administer it.
      await userRepo.updateRole(seed.a.orgId, seed.a.member._id, ROLES.ORG_ADMIN);
      const secondAdmin = accessCookieFor({ ...seed.a.member.toObject(), role: ROLES.ORG_ADMIN });

      const results = await Promise.all([
        changeRole(seed.a.member._id, ROLES.MEMBER, asAdminA()),
        changeRole(seed.a.admin._id, ROLES.MEMBER, secondAdmin),
      ]);

      // One wins. The loser is retried against the new state, finds it has just been demoted, and is
      // refused — so it is a 403, not a second successful demotion.
      expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
      expect(await adminCount(seed.a.orgId)).toBe(1);
      expect(await auditFor(seed.a.orgId, AUDIT_ACTION.USER_ROLE_CHANGED)).toHaveLength(1);
    });
  });

  it('refuses an admin who has been demoted since their token was issued (SDD §6.2)', async () => {
    // Two admins so the last-admin rule is not what stops this: it must be the role re-read.
    await userRepo.updateRole(seed.a.orgId, seed.a.member._id, ROLES.ORG_ADMIN);
    const staleToken = accessCookieFor(seed.a.admin);
    await userRepo.updateRole(seed.a.orgId, seed.a.admin._id, ROLES.MEMBER);

    // The stale admin tries to hand themselves their authority back.
    const res = await changeRole(seed.a.admin._id, ROLES.ORG_ADMIN, staleToken);

    expect(res.status).toBe(403);
    expect(await userRepo.findRole(seed.a.orgId, seed.a.admin._id)).toBe(ROLES.MEMBER);
    expect(await auditFor(seed.a.orgId, AUDIT_ACTION.USER_ROLE_CHANGED)).toHaveLength(0);
  });

  it('rolls back the role change, and the session revocation, when the audit write fails (OD-2)', async () => {
    const approver = await loginAs(app, {
      orgSlug: 'org-a',
      email: seed.a.approver.email,
      password: seed.password,
    });
    auditRepo.append.mockRejectedValueOnce(new Error('simulated audit failure'));

    const failed = await changeRole(seed.a.approver._id, ROLES.MEMBER);

    expect(failed.status).toBe(500);
    expect(await userRepo.findRole(seed.a.orgId, seed.a.approver._id)).toBe(ROLES.APPROVER);
    // The revocation was part of the same transaction, so their session is still alive too.
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', approver.refreshCookie)
      .send({});
    expect(refresh.status).toBe(200);
  });

  describe('addressing a user', () => {
    it('answers 404, not 403, for a user in another organisation (SR-2)', async () => {
      const res = await changeRole(seed.b.member._id, ROLES.APPROVER);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await userRepo.findRole(seed.b.orgId, seed.b.member._id)).toBe(ROLES.MEMBER);
      expect(await auditFor(seed.b.orgId, AUDIT_ACTION.USER_ROLE_CHANGED)).toHaveLength(0);
    });

    it('answers 404 for an id that exists nowhere', async () => {
      const res = await changeRole('0'.repeat(24), ROLES.APPROVER);
      expect(res.status).toBe(404);
    });

    it('answers 400 for something that is not an id', async () => {
      const res = await changeRole('not-an-id', ROLES.APPROVER);
      expect(res.status).toBe(400);
    });
  });

  it.each([
    ['an unknown role', { role: 'SUPERUSER' }],
    ['a lower-case role', { role: 'approver' }],
    ['no role', {}],
    ['an operator instead of a role', { role: { $ne: null } }],
  ])('rejects %s with 400 and changes nothing', async (_label, body) => {
    const res = await request(app)
      .patch(`/api/users/${seed.a.member._id}/role`)
      .set('Cookie', asAdminA())
      .send(body);

    expect(res.status).toBe(400);
    expect(await userRepo.findRole(seed.a.orgId, seed.a.member._id)).toBe(ROLES.MEMBER);
  });

  it.each([
    ['an APPROVER', () => accessCookieFor(seed.a.approver)],
    ['a MEMBER', () => accessCookieFor(seed.a.member)],
  ])('is forbidden to %s, who cannot promote themselves (users:manage)', async (_label, cookie) => {
    const actor = cookie();
    const res = await request(app)
      .patch(`/api/users/${seed.a.member._id}/role`)
      .set('Cookie', actor)
      .send({ role: ROLES.ORG_ADMIN });

    expect(res.status).toBe(403);
    expect(await userRepo.findRole(seed.a.orgId, seed.a.member._id)).toBe(ROLES.MEMBER);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .patch(`/api/users/${seed.a.member._id}/role`)
      .send({ role: ROLES.APPROVER });
    expect(res.status).toBe(401);
  });
});

describe('the member lifecycle end to end (what SCRUM-58 and SCRUM-45 need to demo)', () => {
  it('an admin adds an approver and a member; both sign in with the passwords they were given and have the access their role implies', async () => {
    // The founding admin adds two people, choosing each one's initial password.
    const ann = await invite({
      email: 'ann@a.test',
      name: 'Ann',
      role: ROLES.APPROVER,
      password: 'Ann-Initial-Passw0rd',
    });
    const max = await invite({
      email: 'max@a.test',
      name: 'Max',
      password: 'Max-Initial-Passw0rd',
    });
    expect(ann.status).toBe(201);
    expect(max.status).toBe(201);

    const annSession = await loginAs(app, {
      orgSlug: 'org-a',
      email: 'ann@a.test',
      password: 'Ann-Initial-Passw0rd',
    });
    const maxSession = await loginAs(app, {
      orgSlug: 'org-a',
      email: 'max@a.test',
      password: 'Max-Initial-Passw0rd',
    });
    expect(annSession.res.body.user.role).toBe(ROLES.APPROVER);
    expect(maxSession.res.body.user.role).toBe(ROLES.MEMBER);

    // A member can browse the catalogue but cannot manage people or read the audit log.
    const maxCookie = maxSession.accessCookie;
    expect((await request(app).get('/api/assets').set('Cookie', maxCookie)).status).toBe(200);
    expect((await request(app).get('/api/users').set('Cookie', maxCookie)).status).toBe(403);
    expect(
      (
        await request(app).post('/api/users/invite').set('Cookie', maxCookie).send({
          email: 'sneaky@a.test',
          name: 'Sneaky',
          password: INITIAL_PASSWORD,
        })
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/audit').set('Cookie', maxCookie)).status).toBe(403);
    // An approver has more than a member but still cannot manage people.
    expect(
      (await request(app).get('/api/users').set('Cookie', annSession.accessCookie)).status,
    ).toBe(403);

    // The admin sees everyone, and the trail shows who was added.
    const members = await listUsers();
    expect(members.body.total).toBe(5);
    const trail = await request(app)
      .get(`/api/audit?action=${AUDIT_ACTION.USER_INVITED}`)
      .set('Cookie', asAdminA());
    expect(trail.body.total).toBe(2);
  });
});
