// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: token utility tests: HS256 pinning, claims, opaque token hashing, cookie options, duration parsing
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Unit tests for the token primitives (SDD §6.2, SR-4).
 *
 * Access tokens: round-trip with HS256, issuer and audience; refuse to sign without every claim; and
 * reject a token signed with a different secret, garbage, or one with no `exp` — an access token
 * without an expiry would be a permanent session.
 *
 * Refresh tokens: 43-character base64url values that are unique and stored only as a SHA-256 hash.
 *
 * Cookies: `HttpOnly`, `SameSite=Lax`, path-scoped, with a `Max-Age` that follows the token's real
 * lifetime — including the capped case, where a short TTL must shorten the cookie too.
 */
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { durationToMs } from '../../../src/utils/duration.js';
import { AuthError } from '../../../src/utils/errors.js';
import {
  accessCookieOptions,
  clearAccessCookieOptions,
  clearRefreshCookieOptions,
  generateOpaqueToken,
  hashToken,
  refreshCookieOptions,
  signAccessToken,
  verifyAccessToken,
} from '../../../src/utils/tokens.js';

const claims = {
  userId: '5f1d7f3e8b1e4c2a9c8d7e6f',
  orgId: '5f1d7f3e8b1e4c2a9c8d7e70',
  role: 'MEMBER',
};

describe('access tokens', () => {
  it('round-trips claims with HS256, issuer and audience', () => {
    const token = signAccessToken(claims);
    expect(jwt.decode(token, { complete: true }).header.alg).toBe('HS256');
    const verified = verifyAccessToken(token);
    expect(verified).toMatchObject(claims);
    expect(verified.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(verified.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + durationToMs('15m') + 1000,
    );
  });

  it('requires every claim to sign', () => {
    expect(() => signAccessToken({ userId: 'u' })).toThrow(TypeError);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signAccessToken(claims, { secret: 'another-secret-that-is-long-enough-123456' });
    expect(() => verifyAccessToken(token)).toThrow(AuthError);
  });

  it('rejects garbage', () => {
    expect(() => verifyAccessToken('not.a.jwt')).toThrow(AuthError);
    expect(() => verifyAccessToken('')).toThrow(AuthError);
  });
});

describe('opaque refresh tokens', () => {
  it('generates 43-char base64url values that are unique and hashed with SHA-256', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
  });
});

describe('cookie options', () => {
  it('are HttpOnly, SameSite=Lax, path-scoped, with maxAge matching the token lifetime', () => {
    expect(accessCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/api',
      maxAge: durationToMs('15m'),
    });
    const in10min = new Date(Date.now() + 600_000);
    const refresh = refreshCookieOptions(in10min);
    expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api/auth' });
    expect(refresh.maxAge).toBeGreaterThan(590_000);
    expect(refresh.maxAge).toBeLessThanOrEqual(600_000);
    expect(refreshCookieOptions(new Date(Date.now() - 1000)).maxAge).toBe(0);
    expect(clearAccessCookieOptions()).toMatchObject({ path: '/api', httpOnly: true });
    expect(clearRefreshCookieOptions()).toMatchObject({ path: '/api/auth', httpOnly: true });
  });
});

describe('durationToMs', () => {
  it.each([
    ['500ms', 500],
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['2d', 172_800_000],
  ])('%s → %d', (input, ms) => {
    expect(durationToMs(input)).toBe(ms);
  });
  it('rejects malformed values', () => {
    expect(() => durationToMs('15')).toThrow(TypeError);
    expect(() => durationToMs('1w')).toThrow(TypeError);
  });
});

describe('access tokens: expiry is mandatory and cookies follow the capped expiry', () => {
  it('rejects a token without exp', () => {
    const eternal = jwt.sign(
      { org: claims.orgId, role: claims.role },
      'test-only-access-secret-that-is-at-least-32-bytes-long',
      {
        algorithm: 'HS256',
        subject: claims.userId,
        issuer: 'safedrop',
        audience: 'safedrop-api',
      },
    );
    expect(() => verifyAccessToken(eternal)).toThrow(AuthError);
  });

  it('honours a short ttl and derives the cookie maxAge from it', () => {
    const token = signAccessToken(claims, { ttl: '30s' });
    const { expiresAt } = verifyAccessToken(token);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 31_000);
    expect(accessCookieOptions(expiresAt).maxAge).toBeLessThanOrEqual(30_000);
    expect(accessCookieOptions(new Date(Date.now() - 1)).maxAge).toBe(0);
  });
});
