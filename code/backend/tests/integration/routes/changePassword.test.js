// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code)
// AI-Assisted Areas: acceptance and security tests for POST /api/auth/change-password
// Human Contributions: pending team review
// Notes: Must be reviewed by the owning team member before merge.

/**
 * Integration tests for `POST /api/auth/change-password`: a signed-in user replacing their own password.
 *
 * Invited members do not use this — they choose their first password through their emailed link (see
 * invitations.test.js) — so this covers anyone changing a password they already have. What matters:
 *
 *  - **It really replaces the password.** The old one stops working, the new one works, only a hash is
 *    stored, and every other session the account had ends.
 *  - **It cannot be abused.** It needs the current password, refuses to "change" to the same one,
 *    enforces the usual strength rules, only ever acts on the caller, and its failures count against the
 *    login rate limit.
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { resetAuthRateLimiter } from '../../../src/middleware/rateLimit.js';
import { RefreshToken } from '../../../src/models/RefreshToken.js';
import { User } from '../../../src/models/User.js';
import { accessCookieFor, cookieHeaderFrom, loginAs } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  resetAuthRateLimiter();
  seed = await seedTwoOrgs();
});

const CHANGE = '/api/auth/change-password';
const CHOSEN = 'My-Own-Chosen-Passw0rd';
const changePassword = (cookie, body) => request(app).post(CHANGE).set('Cookie', cookie).send(body);
const signIn = (email, password) => loginAs(app, { orgSlug: 'org-a', email, password });
const storedHash = async (user) =>
  (await User.findById(user._id).select('+passwordHash')).passwordHash;

describe('POST /api/auth/change-password', () => {
  it('replaces the password, and the new session is fully usable', async () => {
    const { cookieHeader } = await signIn(seed.a.member.email, seed.password);

    const res = await changePassword(cookieHeader, {
      currentPassword: seed.password,
      newPassword: CHOSEN,
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: seed.a.member.email });
    // Nothing secret comes back — not the new password, not any hash.
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${CHOSEN}|passwordHash|\\$2[aby]\\$`));
    // The browser leaves holding fresh session cookies.
    const fresh = cookieHeaderFrom(res);
    expect((await request(app).get('/api/assets').set('Cookie', fresh)).status).toBe(200);
  });

  it('stores only a bcrypt hash of the new password', async () => {
    const before = await storedHash(seed.a.member);
    await changePassword(accessCookieFor(seed.a.member), {
      currentPassword: seed.password,
      newPassword: CHOSEN,
    });

    const after = await storedHash(seed.a.member);
    expect(after).not.toBe(before);
    expect(after).toMatch(/^\$2[aby]\$12\$/);
    expect(after).not.toContain(CHOSEN);
    expect(await bcrypt.compare(CHOSEN, after)).toBe(true);
  });

  it('makes the old password stop working and the new one start', async () => {
    await changePassword(accessCookieFor(seed.a.member), {
      currentPassword: seed.password,
      newPassword: CHOSEN,
    });
    expect((await signIn(seed.a.member.email, seed.password)).res.status).toBe(401);
    expect((await signIn(seed.a.member.email, CHOSEN)).res.status).toBe(200);
  });

  it('ends every other session the account had', async () => {
    const first = await signIn(seed.a.member.email, seed.password);
    const elsewhere = await signIn(seed.a.member.email, seed.password);

    const res = await changePassword(first.cookieHeader, {
      currentPassword: seed.password,
      newPassword: CHOSEN,
    });
    expect(res.status).toBe(200);

    const stolen = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', elsewhere.refreshCookie)
      .send({});
    expect(stolen.status).toBe(401);
    // Exactly one live session remains: the one just issued.
    expect(await RefreshToken.countDocuments({ userId: seed.a.member._id, revokedAt: null })).toBe(
      1,
    );
  });

  it('refuses a wrong current password with a field error, changes nothing, and keeps the session', async () => {
    const before = await storedHash(seed.a.member);
    const cookie = accessCookieFor(seed.a.member);

    const res = await changePassword(cookie, {
      currentPassword: 'Not-The-Current-One-1',
      newPassword: CHOSEN,
    });

    // 400, not 401: the SPA treats a 401 as a dead session and signs the user out over a typo.
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { location: 'body', path: 'currentPassword', message: 'is incorrect' },
    ]);
    expect(await storedHash(seed.a.member)).toBe(before);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('refuses to "change" a password to the one already in use', async () => {
    const res = await changePassword(accessCookieFor(seed.a.member), {
      currentPassword: seed.password,
      newPassword: seed.password,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.path === 'newPassword')).toBe(true);
  });

  it.each([
    ['a too-short new password', { currentPassword: 'x', newPassword: 'short' }, 'newPassword'],
    [
      'a new password over bcrypt’s 72-byte limit',
      { currentPassword: 'x', newPassword: 'a'.repeat(73) },
      'newPassword',
    ],
    ['a missing new password', { currentPassword: 'x' }, 'newPassword'],
    ['a missing current password', { newPassword: CHOSEN }, 'currentPassword'],
    ['an empty current password', { currentPassword: '', newPassword: CHOSEN }, 'currentPassword'],
    // Rejected before any comparison; which path the validator names is not the point.
    [
      'an operator in place of a password',
      { currentPassword: { $ne: null }, newPassword: CHOSEN },
      null,
    ],
    ['an unknown field', { currentPassword: 'x', newPassword: CHOSEN, role: 'ORG_ADMIN' }, null],
  ])('rejects %s with 400 and changes nothing', async (_label, body, field) => {
    const before = await storedHash(seed.a.member);
    const res = await changePassword(accessCookieFor(seed.a.member), body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    if (field) {
      expect(res.body.error.details.some((d) => d.path === field)).toBe(true);
    }
    expect(await storedHash(seed.a.member)).toBe(before);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post(CHANGE)
      .send({ currentPassword: seed.password, newPassword: CHOSEN });
    expect(res.status).toBe(401);
  });

  it('only ever acts on the caller: there is no way to name another user', async () => {
    const before = await storedHash(seed.a.approver);
    // A caller who guesses someone else's password as "current" still fails against their own hash,
    // and the body has no field through which to aim at another account.
    const res = await changePassword(accessCookieFor(seed.a.member), {
      currentPassword: 'Guess-At-The-Approvers-Pw',
      newPassword: CHOSEN,
    });
    expect(res.status).toBe(400);
    expect(await storedHash(seed.a.approver)).toBe(before);
  });

  it('counts wrong current passwords against the login rate limit (SR-12)', async () => {
    const cookie = accessCookieFor(seed.a.member);
    const attempt = () =>
      changePassword(cookie, { currentPassword: 'Wrong-Guess-Number-1', newPassword: CHOSEN });

    // The test environment allows 5 failures per window; the sixth is refused before any comparison.
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await attempt()).status);
    }
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[5]).toBe(429);
  });
});
