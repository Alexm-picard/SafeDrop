// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: HS256-pinned access JWT, opaque refresh token generation/hashing, cookie options (SDD §6.2, SR-4)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Session token primitives: access-JWT signing and verification, opaque refresh tokens, and the
 * cookie options both are delivered in (SDD §6.2, SR-4).
 *
 * SafeDrop uses two tokens. The **access token** is a short-lived HS256 JWT carrying the caller's
 * user id, organisation and role — it is self-contained so authenticate() needs no database read.
 * The **refresh token** is an opaque random string; only its SHA-256 hash is stored, so a leaked
 * database dump cannot be replayed as a session.
 *
 * Both travel in `httpOnly` cookies rather than in JavaScript-readable storage, which is what keeps
 * XSS from becoming session theft. The cookie paths are deliberately narrow: the refresh cookie is
 * only sent to `/api/auth`, so ordinary API calls never carry it.
 *
 * This module deals only in token *values*; the rotation, reuse detection and revocation rules live
 * in services/auth.service.js.
 *
 * Exports:
 *  - `signAccessToken(claims, options)` / `verifyAccessToken(token, options)` — the access JWT.
 *  - `generateOpaqueToken()` / `hashToken(raw)` — the refresh token and its stored form.
 *  - `accessCookieOptions()` / `refreshCookieOptions()` — options for setting each cookie.
 *  - `clearAccessCookieOptions()` / `clearRefreshCookieOptions()` — matching options for clearing them.
 *  - Constants: the algorithm, issuer and audience, plus each cookie's name and path.
 */
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { durationToMs } from './duration.js';
import { AuthError } from './errors.js';
import { ROLE_LIST } from './permissions.js';

/** The only algorithm ever accepted. `none`, RS*, ES* and everything else are rejected on verify. */
export const JWT_ALGORITHM = 'HS256';
export const JWT_ISSUER = 'safedrop';
export const JWT_AUDIENCE = 'safedrop-api';

export const ACCESS_COOKIE = 'sd_access';
export const REFRESH_COOKIE = 'sd_refresh';
/** The refresh cookie is only ever sent to the auth endpoints that need it. */
export const REFRESH_COOKIE_PATH = '/api/auth';
export const ACCESS_COOKIE_PATH = '/api';

/**
 * Sign a short-lived access JWT for one user session.
 *
 * The claims are the minimum authenticate() needs to build `req.user` without a database read:
 * subject (user id), `org` and `role`. Issuer and audience are pinned so a token minted for
 * another service cannot be replayed here, and the three claims are required up front because a
 * token missing one would authenticate a user with no tenant or no role.
 * @param {{ userId: string, orgId: string, role: string }} claims
 * @param {{ secret?: string, ttl?: string }} [options] overridable for tests; defaults come from env
 * @returns {string} signed JWT
 * @throws {TypeError} when any of userId, orgId or role is missing
 */
export function signAccessToken(
  { userId, orgId, role },
  { secret = env.JWT_ACCESS_SECRET, ttl = env.JWT_ACCESS_TTL } = {},
) {
  if (!userId || !orgId || !role) {
    throw new TypeError('signAccessToken requires userId, orgId and role');
  }
  return jwt.sign({ org: String(orgId), role }, secret, {
    algorithm: JWT_ALGORITHM,
    subject: String(userId),
    expiresIn: ttl,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

/**
 * Verify an access token and return the identity it asserts.
 *
 * The algorithm is pinned to a single-element allow-list, which is what defeats the classic
 * `alg: none` and HS/RS confusion attacks — without it, an attacker chooses how their own token is
 * verified. Issuer, audience and expiry are checked too (with 5 seconds of clock tolerance for
 * skew between the API and the signer), and the decoded payload is re-checked for a usable subject,
 * organisation and known role, so a token signed with a valid key but a nonsense role is refused.
 *
 * Every failure becomes the same `AuthError`; the underlying reason is kept in `cause` for the
 * logs so the response never tells a caller why their forgery failed.
 * @param {string} token
 * @param {{ secret?: string }} [options]
 * @returns {{ userId: string, orgId: string, role: string, expiresAt: Date }}
 * @throws {AuthError} on a bad signature, wrong algorithm, expiry, wrong issuer/audience or a malformed payload
 */
export function verifyAccessToken(token, { secret = env.JWT_ACCESS_SECRET } = {}) {
  let payload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: 5,
    });
  } catch (err) {
    const expired = err?.name === 'TokenExpiredError';
    throw new AuthError(expired ? 'Access token expired' : 'Invalid access token', err);
  }
  if (
    typeof payload !== 'object' ||
    typeof payload.exp !== 'number' ||
    !payload.sub ||
    !payload.org ||
    !ROLE_LIST.includes(payload.role)
  ) {
    throw new AuthError('Invalid access token');
  }
  return {
    userId: payload.sub,
    orgId: payload.org,
    role: payload.role,
    expiresAt: new Date(payload.exp * 1000),
  };
}

/**
 * Mint a refresh token: 256 bits from the CSPRNG, base64url-encoded.
 *
 * The value carries no meaning and is never signed — it is a lookup key. This raw value is what
 * goes to the client; only `hashToken()` of it is ever stored.
 * @returns {string} URL-safe random token
 */
export function generateOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Hash a refresh token into the form stored in the database.
 *
 * A plain SHA-256 is right here, unlike for passwords: the input is 256 bits of randomness, so
 * there is nothing to brute-force or guess, and a fast digest keeps refresh cheap. The point is
 * that a stolen database row cannot be presented as a session.
 * @param {string} raw the token as handed to the client
 * @returns {string} hex-encoded SHA-256 digest
 */
export function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}

const baseCookie = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
});

/**
 * Cookie options for the access token.
 *
 * The cookie is scoped to `/api` and expires with the token itself. Passing the session's real
 * expiry keeps the two in step — the access token is capped to the remaining session life, so the
 * cookie must not outlive it. `Math.max(0, …)` guards an already-past expiry, which would
 * otherwise become a negative max-age.
 * @param {Date} [expiresAt] when the access token stops being valid (defaults to now + JWT_ACCESS_TTL)
 * @returns {import('express').CookieOptions}
 */
export function accessCookieOptions(expiresAt) {
  const maxAge = expiresAt
    ? Math.max(0, expiresAt.getTime() - Date.now())
    : durationToMs(env.JWT_ACCESS_TTL);
  return { ...baseCookie(), path: ACCESS_COOKIE_PATH, maxAge };
}

/**
 * Cookie options for the refresh token.
 *
 * Scoped to `/api/auth`, so the browser attaches this cookie only to login, refresh and logout —
 * ordinary API calls never carry it, and a request forged against some other endpoint cannot use it.
 * @param {Date} expiresAt when the refresh token stops being accepted
 * @returns {import('express').CookieOptions}
 */
export function refreshCookieOptions(expiresAt) {
  return {
    ...baseCookie(),
    path: REFRESH_COOKIE_PATH,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  };
}

/**
 * Options for clearing the access cookie at logout.
 *
 * Browsers only remove a cookie when the clearing attributes match the ones it was set with, so
 * these must stay in step with `accessCookieOptions()` — a mismatched path leaves the cookie in
 * place and logout silently fails.
 * @returns {import('express').CookieOptions}
 */
export function clearAccessCookieOptions() {
  return { ...baseCookie(), path: ACCESS_COOKIE_PATH };
}

/**
 * Options for clearing the refresh cookie at logout; mirrors `refreshCookieOptions()`.
 * @returns {import('express').CookieOptions}
 */
export function clearRefreshCookieOptions() {
  return { ...baseCookie(), path: REFRESH_COOKIE_PATH };
}
