// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: SCRUM-102 login/refresh/logout/me behaviour incl. race-safe rotation, reuse detection + grace window, session caps, rate limiting (SR-3, SR-4, SR-12)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Integration tests for the session endpoints (SDD §6.2, SR-3, SR-4).
 *
 * The most security-sensitive suite in the project. It covers login (cookie attributes, the identical
 * 401 for every kind of wrong credential, per-organisation email uniqueness, rate limiting), `GET /me`
 * (including tampered, expired and `alg:none` tokens), and refresh-token rotation.
 *
 * The rotation tests are the heart of it: a rotated token reused outside the grace window must revoke
 * the entire family, the same reuse inside the window must not, and two concurrent refreshes with one
 * token must leave exactly one winner and a surviving family. Those three cases are why the raw
 * `refreshtokens` collection is read directly — the invariants are about stored rows, not responses.
 */
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { env } from '../../../src/config/env.js';
import { resetAuthRateLimiter } from '../../../src/middleware/rateLimit.js';
import { RefreshToken } from '../../../src/models/RefreshToken.js';
import { REFRESH_REUSE_GRACE_MS } from '../../../src/services/auth.service.js';
import {
  ACCESS_COOKIE,
  JWT_AUDIENCE,
  JWT_ISSUER,
  REFRESH_COOKIE,
  verifyAccessToken,
} from '../../../src/utils/tokens.js';
import { accessCookieFor, loginAs, parseSetCookies } from '../../helpers/authAs.js';
import { seedTwoOrgs, TEST_PASSWORD } from '../../helpers/seedTwoOrgs.js';

const stripRequestId = (body) => {
  const clone = structuredClone(body);
  delete clone.error?.requestId;
  return clone;
};
const refreshWith = (cookie) =>
  request(app).post('/api/auth/refresh').set('Cookie', cookie).send({});
const refreshCookieOf = (res) => `${REFRESH_COOKIE}=${parseSetCookies(res)[REFRESH_COOKIE].value}`;
/** Driver-level write so immutable fields can be aged for a test. */
const rawTokens = () => mongoose.connection.db.collection('refreshtokens');

let seed;
beforeEach(async () => {
  resetAuthRateLimiter();
  seed = await seedTwoOrgs();
});

const creds = () => ({ orgSlug: 'org-a', email: seed.a.member.email, password: TEST_PASSWORD });

describe('POST /api/auth/login', () => {
  it('sets HttpOnly SameSite=Lax cookies and returns the user without passwordHash', async () => {
    const { res, cookies } = await loginAs(app, creds());
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: seed.a.member.email,
      role: 'MEMBER',
      orgId: seed.a.orgId,
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('$2');

    expect(cookies[ACCESS_COOKIE].attributes).toMatchObject({
      httponly: true,
      samesite: 'Lax',
      path: '/api',
    });
    expect(cookies[REFRESH_COOKIE].attributes).toMatchObject({
      httponly: true,
      samesite: 'Lax',
      path: '/api/auth',
    });
    expect(Number(cookies[ACCESS_COOKIE].attributes['max-age'])).toBeLessThanOrEqual(15 * 60);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the identical 401 body for wrong password, unknown email and unknown org', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ ...creds(), password: 'nope-nope-nope' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ ...creds(), email: 'ghost@a.test' });
    const unknownOrg = await request(app)
      .post('/api/auth/login')
      .send({ ...creds(), orgSlug: 'org-zzz' });
    for (const res of [wrongPassword, unknownEmail, unknownOrg]) {
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(stripRequestId(wrongPassword.body)).toEqual(stripRequestId(unknownEmail.body));
    expect(stripRequestId(unknownEmail.body)).toEqual(stripRequestId(unknownOrg.body));
    expect(wrongPassword.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('cannot log into org B with org A credentials (email is unique per org, OD-3)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ ...creds(), orgSlug: 'org-b' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown body keys and operator-shaped values with 400', async () => {
    const extra = await request(app)
      .post('/api/auth/login')
      .send({ ...creds(), remember: true });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('VALIDATION_ERROR');
    const injected = await request(app)
      .post('/api/auth/login')
      .send({ ...creds(), password: { $ne: null } });
    expect(injected.status).toBe(400);
  });

  it('requires application/json and an allowed Origin', async () => {
    const form = await request(app)
      .post('/api/auth/login')
      .type('form')
      .send('orgSlug=org-a&email=x&password=y');
    expect(form.status).toBe(415);
    const evil = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send(creds());
    expect(evil.status).toBe(403);
    const ok = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send(creds());
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('logging in again revokes the refresh family the browser already held', async () => {
    const first = await loginAs(app, creds());
    const again = await request(app)
      .post('/api/auth/login')
      .set('Cookie', first.cookieHeader)
      .send(creds());
    expect(again.status).toBe(200);
    const stale = await refreshWith(first.refreshCookie);
    expect(stale.status).toBe(401);
    const fresh = await refreshWith(refreshCookieOf(again));
    expect(fresh.status).toBe(200);
  });

  it('returns 429 once the auth rate limit is exceeded (SR-12)', async () => {
    const bad = { ...creds(), password: 'wrong-wrong-wrong' };
    for (let i = 0; i < env.RATE_LIMIT_AUTH_MAX; i += 1) {
      const res = await request(app).post('/api/auth/login').send(bad);
      expect(res.status).toBe(401);
    }
    const limited = await request(app).post('/api/auth/login').send(bad);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers.ratelimit).toBeDefined();
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user and organisation with a valid access cookie', async () => {
    const { accessCookie } = await loginAs(app, creds());
    const res = await request(app).get('/api/auth/me').set('Cookie', accessCookie);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(String(seed.a.member._id));
    expect(res.body.organization).toEqual({ id: seed.a.orgId, name: 'Org A', slug: 'org-a' });
  });

  it('rejects a missing, expired, never-expiring, tampered or alg:none token with 401', async () => {
    const missing = await request(app).get('/api/auth/me');
    expect(missing.status).toBe(401);

    const signOpts = {
      algorithm: 'HS256',
      subject: String(seed.a.member._id),
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    };
    const expiredToken = jwt.sign(
      { org: seed.a.orgId, role: 'MEMBER', exp: Math.floor(Date.now() / 1000) - 60 },
      env.JWT_ACCESS_SECRET,
      signOpts,
    );
    const expired = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_COOKIE}=${expiredToken}`);
    expect(expired.status).toBe(401);

    const eternalToken = jwt.sign(
      { org: seed.a.orgId, role: 'MEMBER' },
      env.JWT_ACCESS_SECRET,
      signOpts,
    );
    const eternal = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_COOKIE}=${eternalToken}`);
    expect(eternal.status).toBe(401);

    const tampered = accessCookieFor(seed.a.member).replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    const bad = await request(app).get('/api/auth/me').set('Cookie', tampered);
    expect(bad.status).toBe(401);

    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      sub: String(seed.a.admin._id),
      org: seed.a.orgId,
      role: 'ORG_ADMIN',
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;
    const noneRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_COOKIE}=${none}`);
    expect(noneRes.status).toBe(401);
  });

  it('rejects unknown query parameters (routes accept only what they declare)', async () => {
    const { accessCookie } = await loginAs(app, creds());
    const res = await request(app).get('/api/auth/me?verbose=1').set('Cookie', accessCookie);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const first = await loginAs(app, creds());
    const res = await refreshWith(first.refreshCookie);
    expect(res.status).toBe(200);
    const cookies = parseSetCookies(res);
    expect(cookies[REFRESH_COOKIE].value).not.toBe(first.cookies[REFRESH_COOKIE].value);
    expect(cookies[ACCESS_COOKIE].value).toBeTruthy();

    const docs = await RefreshToken.find({ userId: seed.a.member._id }).sort({ createdAt: 1 });
    expect(docs).toHaveLength(2);
    expect(String(docs[0].replacedBy)).toBe(String(docs[1]._id));
    expect(String(docs[0].familyId)).toBe(String(docs[1].familyId));
    expect(docs[0].lastUsedAt).toBeInstanceOf(Date);
    expect(docs[1].absoluteExpiresAt.getTime()).toBe(docs[0].absoluteExpiresAt.getTime());
  });

  it('reusing a rotated token outside the grace window revokes the whole family', async () => {
    const first = await loginAs(app, creds());
    const second = await refreshWith(first.refreshCookie);
    const secondRefresh = refreshCookieOf(second);
    // Age the rotation past the grace window.
    await RefreshToken.updateMany(
      { userId: seed.a.member._id, replacedBy: mongoose.trusted({ $ne: null }) },
      { $set: { lastUsedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000) } },
    );

    const reuse = await refreshWith(first.refreshCookie);
    expect(reuse.status).toBe(401);

    const victim = await refreshWith(secondRefresh);
    expect(victim.status).toBe(401);
    const revoked = await RefreshToken.countDocuments({
      userId: seed.a.member._id,
      revokedAt: mongoose.trusted({ $ne: null }),
    });
    expect(revoked).toBe(2);
  });

  it('reusing a rotated token inside the grace window is refused but does not revoke the family', async () => {
    const first = await loginAs(app, creds());
    const second = await refreshWith(first.refreshCookie);
    const reuse = await refreshWith(first.refreshCookie);
    expect(reuse.status).toBe(401);
    const stillFine = await refreshWith(refreshCookieOf(second));
    expect(stillFine.status).toBe(200);
    const revoked = await RefreshToken.countDocuments({
      userId: seed.a.member._id,
      revokedAt: mongoose.trusted({ $ne: null }),
    });
    expect(revoked).toBe(0);
  });

  it('two concurrent refreshes with the same token: exactly one wins and the family survives', async () => {
    const first = await loginAs(app, creds());
    const results = await Promise.all([
      refreshWith(first.refreshCookie),
      refreshWith(first.refreshCookie),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
    const winner = results.find((r) => r.status === 200);
    const next = await refreshWith(refreshCookieOf(winner));
    expect(next.status).toBe(200);
    expect(await RefreshToken.countDocuments({ userId: seed.a.member._id })).toBe(3);
  });

  it('a revoked family cannot be resurrected by a refresh that lost the race with logout', async () => {
    const first = await loginAs(app, creds());
    await request(app).post('/api/auth/logout').set('Cookie', first.cookieHeader).send({});
    const res = await refreshWith(first.refreshCookie);
    expect(res.status).toBe(401);
    expect(await RefreshToken.countDocuments({ userId: seed.a.member._id, revokedAt: null })).toBe(
      0,
    );
  });

  it('fails closed without a cookie or with an unknown token, and clears cookies', async () => {
    const missing = await request(app).post('/api/auth/refresh').send({});
    expect(missing.status).toBe(401);
    const unknown = await refreshWith(`${REFRESH_COOKIE}=not-a-real-token`);
    expect(unknown.status).toBe(401);
    const cleared = parseSetCookies(unknown);
    expect(cleared[REFRESH_COOKIE].value).toBe('');
    expect(cleared[ACCESS_COOKIE].value).toBe('');
  });

  it('rejects an idle-expired token', async () => {
    const first = await loginAs(app, creds());
    await RefreshToken.updateMany(
      { userId: seed.a.member._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const res = await refreshWith(first.refreshCookie);
    expect(res.status).toBe(401);
  });

  it('never issues an access token that outlives the absolute session limit', async () => {
    const first = await loginAs(app, creds());
    const absoluteExpiresAt = new Date(Date.now() + 60_000);
    await rawTokens().updateMany({ userId: seed.a.member._id }, { $set: { absoluteExpiresAt } });
    const res = await refreshWith(first.refreshCookie);
    expect(res.status).toBe(200);
    const cookies = parseSetCookies(res);
    const { expiresAt } = verifyAccessToken(cookies[ACCESS_COOKIE].value);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(absoluteExpiresAt.getTime() + 1000);
    expect(Number(cookies[ACCESS_COOKIE].attributes['max-age'])).toBeLessThanOrEqual(60);
    expect(Number(cookies[REFRESH_COOKIE].attributes['max-age'])).toBeLessThanOrEqual(60);

    await rawTokens().updateMany(
      { userId: seed.a.member._id },
      { $set: { absoluteExpiresAt: new Date(Date.now() - 1000) } },
    );
    const dead = await refreshWith(refreshCookieOf(res));
    expect(dead.status).toBe(401);
  });

  it('rejects unknown body keys', async () => {
    const first = await loginAs(app, creds());
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', first.refreshCookie)
      .send({ orgId: seed.b.orgId, x: 1 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears both cookies and revokes the refresh family', async () => {
    const session = await loginAs(app, creds());
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', session.cookieHeader)
      .send({});
    expect(res.status).toBe(204);
    const cleared = parseSetCookies(res);
    expect(cleared[ACCESS_COOKIE].value).toBe('');
    expect(cleared[REFRESH_COOKIE].value).toBe('');

    const again = await refreshWith(session.refreshCookie);
    expect(again.status).toBe(401);
  });

  it('requires a session', async () => {
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(401);
  });
});
