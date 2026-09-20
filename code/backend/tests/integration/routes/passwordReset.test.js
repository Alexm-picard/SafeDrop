// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: acceptance and security tests for forgot-password / reset-password: expiry, single use, no account enumeration, session revocation, rate limit
// Human Contributions: pending team review
// Notes: Written for SCRUM-22. Must be reviewed and tested by the owning team member before merge.

/**
 * Integration tests for the forgotten-password flow (SCRUM-22).
 *
 * The happy path is small; nearly everything worth testing here is a refusal:
 *
 *  - **It tells a stranger nothing.** An unknown address, an unknown organisation and a real
 *    account produce byte-identical answers, so the endpoint cannot be used to discover who has an
 *    account (SR-2).
 *  - **The link is single-use and short-lived.** Ten minutes, one spend, and asking again
 *    invalidates the previous link.
 *  - **Only a hash is stored.** The database never holds anything that could be pasted into a
 *    browser.
 *  - **A reset ends every other session**, which is the point of resetting after a compromise.
 *
 * The mail never leaves the process: `MAIL_PROVIDER` is `console` under test, and that transport
 * keeps what it "sent" in `sentMail`, which is where these tests read the link from — the same
 * thing a developer reads out of the log locally.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { resetAuthRateLimiter } from '../../../src/middleware/rateLimit.js';
import { AuditEvent } from '../../../src/models/AuditEvent.js';
import { RefreshToken } from '../../../src/models/RefreshToken.js';
import { User } from '../../../src/models/User.js';
import { clearSentMail, sentMail } from '../../../src/services/mail/mailer.js';
import { AUDIT_ACTION } from '../../../src/utils/constants.js';
import { hashToken } from '../../../src/utils/tokens.js';
import { loginAs } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

const FORGOT = '/api/auth/forgot-password';
const RESET = '/api/auth/reset-password';
const NEW_PASSWORD = 'A-Brand-New-Passw0rd';

let seed;
beforeEach(async () => {
  resetAuthRateLimiter();
  clearSentMail();
  seed = await seedTwoOrgs();
});

const forgot = (body) => request(app).post(FORGOT).send(body);
const reset = (body) => request(app).post(RESET).send(body);
const signIn = (email, password) => loginAs(app, { orgSlug: 'org-a', email, password });

/** Ask for a link as the seeded member and return the token out of the captured mail. */
async function requestLinkForMember() {
  const res = await forgot({ orgSlug: 'org-a', email: seed.a.member.email });
  expect(res.status).toBe(202);
  const last = sentMail.at(-1);
  expect(last.to).toBe(seed.a.member.email);
  const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(last.text);
  expect(match, 'the email should contain a reset link').not.toBeNull();
  return match[1];
}

describe('POST /api/auth/forgot-password', () => {
  it('emails a single-use link and stores only its hash', async () => {
    const token = await requestLinkForMember();

    const stored = await User.findById(seed.a.member._id).select(
      '+resetTokenHash +resetTokenExpiresAt',
    );
    expect(stored.resetTokenHash).toBe(hashToken(token));
    expect(stored.resetTokenHash).not.toBe(token);
    // Ten minutes, give or take the time the test itself took.
    const ttlMs = stored.resetTokenExpiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(9 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60_000);
    // Nothing that could be used as a link is written to the audit trail either.
    expect(JSON.stringify(await AuditEvent.find({}).lean())).not.toContain(token);
  });

  it('answers identically for a real account, an unknown address and an unknown organization (SR-2)', async () => {
    const real = await forgot({ orgSlug: 'org-a', email: seed.a.member.email });
    const unknownEmail = await forgot({ orgSlug: 'org-a', email: 'nobody@a.test' });
    const unknownOrg = await forgot({ orgSlug: 'no-such-org', email: seed.a.member.email });

    for (const res of [real, unknownEmail, unknownOrg]) {
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ message: 'If that account exists, a reset link is on its way.' });
    }
    // ...and only the real one actually produced mail.
    expect(sentMail).toHaveLength(1);
  });

  it('does not reveal that the same address exists in another organization (SR-2)', async () => {
    const res = await forgot({ orgSlug: 'org-a', email: seed.b.member.email });
    expect(res.status).toBe(202);
    expect(sentMail).toHaveLength(0);
  });

  it('replaces a previous link, so only the newest one works', async () => {
    const first = await requestLinkForMember();
    const second = await requestLinkForMember();
    expect(second).not.toBe(first);

    expect((await reset({ token: first, newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await reset({ token: second, newPassword: NEW_PASSWORD })).status).toBe(204);
  });

  it('requires an organization slug and a well-formed address', async () => {
    expect((await forgot({ email: seed.a.member.email })).status).toBe(400);
    expect((await forgot({ orgSlug: 'org-a' })).status).toBe(400);
    expect((await forgot({ orgSlug: 'org-a', email: 'not-an-email' })).status).toBe(400);
    expect(
      (await forgot({ orgSlug: 'org-a', email: seed.a.member.email, admin: true })).status,
    ).toBe(400);
  });

  it('is rate limited, since every answer is a success (SR-12)', async () => {
    const body = { orgSlug: 'org-a', email: 'nobody@a.test' };
    for (let i = 0; i < 5; i += 1) {
      expect((await forgot(body)).status).toBe(202);
    }
    const blocked = await forgot(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/auth/reset-password', () => {
  it('sets the new password, ends every other session, and records one audit entry', async () => {
    // An existing session that must not survive the reset.
    const { cookieHeader } = await signIn(seed.a.member.email, seed.password);
    expect(await RefreshToken.countDocuments({ userId: seed.a.member._id, revokedAt: null })).toBe(
      1,
    );

    const token = await requestLinkForMember();
    const res = await reset({ token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    // The old password is dead, the new one works.
    expect((await signIn(seed.a.member.email, seed.password)).res.status).toBe(401);
    const after = await signIn(seed.a.member.email, NEW_PASSWORD);
    expect(after.res.body.user.email).toBe(seed.a.member.email);

    // The session that existed before the reset is revoked, and the refresh cookie it held is dead.
    const stillLive = await RefreshToken.countDocuments({
      userId: seed.a.member._id,
      revokedAt: null,
    });
    expect(stillLive).toBe(1); // only the one just created by signing in again
    const refreshAttempt = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader)
      .set('Content-Type', 'application/json')
      .send({});
    expect(refreshAttempt.status).toBe(401);

    const events = await AuditEvent.find({ action: AUDIT_ACTION.USER_PASSWORD_RESET }).lean();
    expect(events).toHaveLength(1);
    expect(String(events[0].orgId)).toBe(String(seed.a.org._id));
    expect(String(events[0].targetId)).toBe(String(seed.a.member._id));
  });

  it('refuses a token that was already spent', async () => {
    const token = await requestLinkForMember();
    expect((await reset({ token, newPassword: NEW_PASSWORD })).status).toBe(204);

    const second = await reset({ token, newPassword: 'Yet-Another-Passw0rd' });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('VALIDATION_ERROR');
    // The first reset stands: the second attempt did not change anything.
    const after = await signIn(seed.a.member.email, NEW_PASSWORD);
    expect(after.res.body.user.email).toBe(seed.a.member.email);
  });

  it('refuses an expired link, without changing the password', async () => {
    const token = await requestLinkForMember();
    // Reach into the stored expiry rather than waiting ten minutes.
    await User.updateOne(
      { _id: seed.a.member._id },
      { $set: { resetTokenExpiresAt: new Date(Date.now() - 1000) } },
    );

    const res = await reset({ token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    const stillWorks = await signIn(seed.a.member.email, seed.password);
    expect(stillWorks.res.body.user.email).toBe(seed.a.member.email);
  });

  it('refuses an unknown token with the same message as an expired one', async () => {
    const expired = await (async () => {
      const token = await requestLinkForMember();
      await User.updateOne(
        { _id: seed.a.member._id },
        { $set: { resetTokenExpiresAt: new Date(Date.now() - 1000) } },
      );
      return reset({ token, newPassword: NEW_PASSWORD });
    })();
    const unknown = await reset({ token: 'not-a-real-token', newPassword: NEW_PASSWORD });

    expect(unknown.status).toBe(expired.status);
    expect(unknown.body.error.message).toBe(expired.body.error.message);
    expect(unknown.body.error.details).toEqual(expired.body.error.details);
  });

  it('applies the password rules to the new password', async () => {
    const token = await requestLinkForMember();
    const tooShort = await reset({ token, newPassword: 'short' });
    expect(tooShort.status).toBe(400);
    expect(JSON.stringify(tooShort.body)).toMatch(/newPassword/);
    // The link survives a rejected attempt, so a typo does not force a second email.
    expect((await reset({ token, newPassword: NEW_PASSWORD })).status).toBe(204);
  });
});
