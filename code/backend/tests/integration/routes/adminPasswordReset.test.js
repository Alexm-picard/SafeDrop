// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: acceptance and security tests for POST /api/users/:id/password and the forced-change gate
// Human Contributions: pending team review
// Notes: Written for SCRUM-22 / SCRUM-36. Must be reviewed and tested by the owning team member before merge.

/**
 * Integration tests for an admin setting a member's password, and for what that password can do.
 *
 * This is the fallback when the emailed link cannot work — a lost mailbox, a forgotten address. Two
 * requirements meet here:
 *
 *  - **Only an admin, only in their own organisation.** A member or approver is refused, and a user
 *    in another organisation is a 404 rather than a 403, so the endpoint cannot be used to discover
 *    that an account exists elsewhere (SR-2).
 *  - **A password someone else chose is a one-way ticket.** Signing in with it reaches the
 *    change-password route and nothing else, so an admin never keeps working knowledge of a
 *    member's credentials. That gate is enforced by the API, not by the SPA (SR-1).
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { resetAuthRateLimiter } from '../../../src/middleware/rateLimit.js';
import { AuditEvent } from '../../../src/models/AuditEvent.js';
import { RefreshToken } from '../../../src/models/RefreshToken.js';
import { User } from '../../../src/models/User.js';
import { AUDIT_ACTION } from '../../../src/utils/constants.js';
import { accessCookieFor, cookieHeaderFrom, loginAs } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

const SET_BY_ADMIN = 'Admin-Set-Passw0rd';
const CHOSEN = 'My-Own-Chosen-Passw0rd';

let seed;
beforeEach(async () => {
  resetAuthRateLimiter();
  seed = await seedTwoOrgs();
});

const asAdminA = () => accessCookieFor(seed.a.admin);
const setPassword = (userId, password, cookie = asAdminA()) =>
  request(app).post(`/api/users/${userId}/password`).set('Cookie', cookie).send({ password });
const signIn = (email, password) => loginAs(app, { orgSlug: 'org-a', email, password });

describe('POST /api/users/:id/password', () => {
  it('replaces the password, revokes the member’s sessions and records who did it', async () => {
    // The member is signed in when the admin resets it.
    const before = await signIn(seed.a.member.email, seed.password);
    expect(before.res.status).toBe(200);

    const res = await setPassword(seed.a.member._id, SET_BY_ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(SET_BY_ADMIN);

    // Every session they held is revoked. Checked before signing in again, which would add a live
    // one. `$ne` is not usable here: Mongoose runs with sanitizeFilter, so operators in a filter
    // value are neutralised (SR-6) — the documents are read and checked instead.
    const tokens = await RefreshToken.find({ userId: seed.a.member._id }).lean();
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);

    // Their old password is gone and the one the admin set works.
    expect((await signIn(seed.a.member.email, seed.password)).res.status).toBe(401);
    expect((await signIn(seed.a.member.email, SET_BY_ADMIN)).res.status).toBe(200);

    const events = await AuditEvent.find({ action: AUDIT_ACTION.USER_PASSWORD_RESET }).lean();
    expect(events).toHaveLength(1);
    expect(String(events[0].actorId)).toBe(String(seed.a.admin._id));
    expect(String(events[0].targetId)).toBe(String(seed.a.member._id));
    expect(JSON.stringify(events[0])).not.toContain(SET_BY_ADMIN);
  });

  it('is refused for anyone without users:manage', async () => {
    for (const user of [seed.a.member, seed.a.approver]) {
      const res = await setPassword(seed.a.member._id, SET_BY_ADMIN, accessCookieFor(user));
      expect(res.status).toBe(403);
    }
    // ...and the password did not change.
    expect((await signIn(seed.a.member.email, seed.password)).res.status).toBe(200);
  });

  it('cannot reach into another organization (404, not 403 — SR-2)', async () => {
    const res = await setPassword(seed.b.member._id, SET_BY_ADMIN);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses an admin aiming it at their own account', async () => {
    const res = await setPassword(seed.a.admin._id, SET_BY_ADMIN);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/change-password/i);
  });

  it('applies the usual password rules', async () => {
    const res = await setPassword(seed.a.member._id, 'short');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/password/i);
  });
});

describe('a session using a password somebody else chose', () => {
  /** Reset the member's password as the admin, then sign in as them with it. */
  async function confinedSession() {
    await setPassword(seed.a.member._id, SET_BY_ADMIN);
    const session = await signIn(seed.a.member.email, SET_BY_ADMIN);
    expect(session.res.body.user.mustChangePassword).toBe(true);
    return session;
  }

  it('is refused everywhere except the way out', async () => {
    const session = await confinedSession();
    const cookie = session.accessCookie;

    for (const path of ['/api/assets', '/api/requests', '/api/users', '/api/audit']) {
      const res = await request(app).get(path).set('Cookie', cookie);
      expect(res.status, `${path} should be refused`).toBe(403);
      expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }

    // /me still answers, or the SPA could not discover why it is being refused.
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);
  });

  it('is lifted by choosing a password, and the new session can work again', async () => {
    const session = await confinedSession();
    const changed = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', session.cookieHeader)
      .send({ currentPassword: SET_BY_ADMIN, newPassword: CHOSEN });

    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect(await User.findById(seed.a.member._id).then((u) => u.mustChangePassword)).toBe(false);

    const free = await request(app).get('/api/assets').set('Cookie', cookieHeaderFrom(changed));
    expect(free.status).toBe(200);
    // Signing in fresh with the chosen password is unrestricted too.
    const later = await signIn(seed.a.member.email, CHOSEN);
    expect(later.res.body.user.mustChangePassword).toBe(false);
    expect((await request(app).get('/api/assets').set('Cookie', later.accessCookie)).status).toBe(
      200,
    );
  });

  it('can still log out', async () => {
    const session = await confinedSession();
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', session.cookieHeader)
      .send({});
    expect(res.status).toBe(204);
  });
});
