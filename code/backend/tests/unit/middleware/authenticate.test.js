// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: authenticate middleware unit tests: alg:none, expiry, public routes, req.auth shape
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Unit tests for the authenticate middleware.
 *
 * Mostly a list of tokens that must be rejected: missing, `alg: none`, signed with another algorithm
 * or secret, wrong issuer, expired, or carrying a role that is not one of the three. Each is a
 * separate way of forging a session, and each must fail identically.
 *
 * It also pins the two positive behaviours: `req.auth` is attached and frozen for a valid token, and
 * the three public routes pass through without a cookie — including with trailing slashes and query
 * strings, so path matching cannot be side-stepped.
 */
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../../../src/config/env.js';
import { authenticate, createAuthenticate } from '../../../src/middleware/authenticate.js';
import { AuthError } from '../../../src/utils/errors.js';
import {
  ACCESS_COOKIE,
  JWT_AUDIENCE,
  JWT_ISSUER,
  signAccessToken,
} from '../../../src/utils/tokens.js';

const ids = { userId: '5f1d7f3e8b1e4c2a9c8d7e6f', orgId: '5f1d7f3e8b1e4c2a9c8d7e70' };
const run = (req) =>
  new Promise((resolve) => {
    // Fill defaults onto the caller's object so assertions can read req.auth afterwards.
    Object.assign(req, { method: 'GET', originalUrl: '/api/assets', cookies: {}, ...req });
    authenticate(req, {}, (err) => resolve(err));
  });

describe('authenticate', () => {
  it('attaches frozen req.auth = { userId, orgId, role } for a valid token', async () => {
    const req = { cookies: { [ACCESS_COOKIE]: signAccessToken({ ...ids, role: 'APPROVER' }) } };
    expect(await run(req)).toBeUndefined();
    expect(req.auth).toEqual({ userId: ids.userId, orgId: ids.orgId, role: 'APPROVER' });
    expect(Object.isFrozen(req.auth)).toBe(true);
  });

  it('lets the three public routes through without a cookie, including trailing slashes and query strings', async () => {
    for (const url of ['/api/auth/login', '/api/auth/refresh/', '/api/organizations?x=1']) {
      expect(await run({ method: 'POST', originalUrl: url })).toBeUndefined();
    }
    // Same paths with a different method are NOT public.
    expect(await run({ method: 'GET', originalUrl: '/api/auth/login' })).toBeInstanceOf(AuthError);
  });

  it('rejects a missing cookie with AuthError', async () => {
    expect(await run({})).toBeInstanceOf(AuthError);
  });

  it('rejects alg:none', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: ids.userId, org: ids.orgId, role: 'ORG_ADMIN', iss: JWT_ISSUER, aud: JWT_AUDIENCE })}.`;
    const err = await run({ cookies: { [ACCESS_COOKIE]: token } });
    expect(err).toBeInstanceOf(AuthError);
  });

  it('rejects a token signed with another algorithm/secret, wrong issuer, or expired', async () => {
    const wrongSecret = jwt.sign({ org: ids.orgId, role: 'MEMBER' }, 'x'.repeat(40), {
      subject: ids.userId,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: '5m',
    });
    const wrongIssuer = jwt.sign({ org: ids.orgId, role: 'MEMBER' }, env.JWT_ACCESS_SECRET, {
      subject: ids.userId,
      issuer: 'someone-else',
      audience: JWT_AUDIENCE,
      expiresIn: '5m',
    });
    const expired = jwt.sign(
      { org: ids.orgId, role: 'MEMBER', exp: Math.floor(Date.now() / 1000) - 120 },
      env.JWT_ACCESS_SECRET,
      {
        subject: ids.userId,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );
    const hs512 = jwt.sign({ org: ids.orgId, role: 'MEMBER' }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS512',
      subject: ids.userId,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: '5m',
    });
    for (const token of [wrongSecret, wrongIssuer, expired, hs512]) {
      const err = await run({ cookies: { [ACCESS_COOKIE]: token } });
      expect(err).toBeInstanceOf(AuthError);
      expect(err.status).toBe(401);
    }
    const expiredErr = await run({ cookies: { [ACCESS_COOKIE]: expired } });
    expect(expiredErr.message).toBe('Access token expired');
  });

  it('rejects a token whose role is not one of the three roles', async () => {
    const token = jwt.sign({ org: ids.orgId, role: 'ROOT' }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      subject: ids.userId,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: '5m',
    });
    expect(await run({ cookies: { [ACCESS_COOKIE]: token } })).toBeInstanceOf(AuthError);
  });

  it('wraps unexpected verifier failures as AuthError', async () => {
    const mw = createAuthenticate({
      verify: vi.fn(() => {
        throw new Error('boom');
      }),
    });
    const err = await new Promise((resolve) =>
      mw({ method: 'GET', originalUrl: '/api/x', cookies: { [ACCESS_COOKIE]: 't' } }, {}, resolve),
    );
    expect(err).toBeInstanceOf(AuthError);
  });
});
