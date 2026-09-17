// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: HS256-pinned access JWT, opaque refresh token generation/hashing, cookie options (SDD §6.2, SR-4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
 * @param {{ userId: string, orgId: string, role: string }} claims
 * @param {{ secret?: string, ttl?: string }} [options]
 * @returns {string} signed JWT
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
 * Verify an access token with a pinned algorithm. Any failure (bad signature, `alg: none`, expiry,
 * wrong issuer/audience, malformed role) is an AuthError; details are kept in `cause` for logs only.
 * @param {string} token
 * @param {{ secret?: string }} [options]
 * @returns {{ userId: string, orgId: string, role: string, expiresAt: Date }}
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

/** 256 random bits, URL-safe. This raw value goes to the client; only its hash is stored. */
export function generateOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

/** @param {string} raw */
export function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}

const baseCookie = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
});

/** @param {Date} [expiresAt] when the access token stops being valid (defaults to now + JWT_ACCESS_TTL) */
export function accessCookieOptions(expiresAt) {
  const maxAge = expiresAt
    ? Math.max(0, expiresAt.getTime() - Date.now())
    : durationToMs(env.JWT_ACCESS_TTL);
  return { ...baseCookie(), path: ACCESS_COOKIE_PATH, maxAge };
}

/** @param {Date} expiresAt when the refresh token stops being accepted */
export function refreshCookieOptions(expiresAt) {
  return {
    ...baseCookie(),
    path: REFRESH_COOKIE_PATH,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  };
}

/** Options for res.clearCookie: must match path/secure/sameSite of the original cookie. */
export function clearAccessCookieOptions() {
  return { ...baseCookie(), path: ACCESS_COOKIE_PATH };
}

export function clearRefreshCookieOptions() {
  return { ...baseCookie(), path: REFRESH_COOKIE_PATH };
}
