// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: bcrypt login with constant-time fallback, access JWT capped to the session, race-safe rotating refresh-token family with reuse detection + grace window, logout (SDD §6.2, SR-3, SR-4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// AI-ASSISTED: YES
//   Tool: Claude Code. Prompt: "in-house auth: bcrypt cost 12, 15-min HS256 access token, opaque
//   rotating refresh token (30-min idle, 12-hour absolute), reuse of a rotated token revokes the
//   family, dummy-hash compare when the user is unknown so timing is constant." Revised after an
//   adversarial review: rotation is now a single conditional update, concurrent refreshes inside a
//   10-second grace window no longer revoke the family, the access token never outlives the session,
//   and logging in again ends the family the browser already held.
//   Contribution: ~90%. Modifications: pending. Verification: tests/integration/routes/auth.test.js.
//   Confidence: medium-high; the Security lead should review rotation and cookie scoping.

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { withTransaction } from '../config/db.js';
import * as orgRepo from '../repositories/organization.repository.js';
import * as refreshRepo from '../repositories/refreshToken.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import { BCRYPT_COST, PASSWORD_MAX_BYTES } from '../utils/constants.js';
import { durationToMs } from '../utils/duration.js';
import { AuthError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { generateOpaqueToken, hashToken, signAccessToken } from '../utils/tokens.js';

/**
 * A rotated token presented again within this window is treated as a benign double-submit (two
 * tabs, two in-flight 401 retries) and simply refused; outside the window it is treated as theft
 * and the whole family is revoked. The browser already holds the successor cookie either way.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/**
 * Hash computed once at module load. When login cannot find the user we still run bcrypt.compare
 * against this hash so the response time does not reveal whether the email exists.
 */
const DUMMY_HASH_PROMISE = bcrypt.hash(`dummy-${generateOpaqueToken()}`, BCRYPT_COST);

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_REFRESH = 'Invalid refresh token';

/** @param {string} password */
export async function hashPassword(password) {
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    // bcrypt silently ignores bytes beyond 72; refusing keeps "the whole password counts" true.
    throw new ValidationError('Invalid request', [
      {
        location: 'body',
        path: 'password',
        message: `must be at most ${PASSWORD_MAX_BYTES} bytes`,
      },
    ]);
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

/** @returns {Promise<boolean>} */
export async function verifyPassword(password, passwordHash) {
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}

export function publicUser(user) {
  return {
    id: String(user._id),
    orgId: String(user.orgId),
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

/**
 * Issue a brand-new session (new refresh-token family) for a user. Used by login and by the
 * first-admin bootstrap in organization.service.
 * @param {{ _id: unknown, orgId: unknown, role: string }} user
 * @param {{ session?: import('mongoose').ClientSession, now?: Date }} [options]
 */
export async function startSession(user, { session, now = new Date() } = {}) {
  const orgId = String(user.orgId);
  const userId = String(user._id);
  const familyId = new mongoose.Types.ObjectId();
  const absoluteExpiresAt = new Date(now.getTime() + durationToMs(env.JWT_REFRESH_ABSOLUTE_TTL));
  return issueTokens(
    { orgId, userId, role: user.role, familyId, absoluteExpiresAt },
    { session, now },
  );
}

/**
 * Create the next refresh token of a family and an access token that can never outlive it.
 * @returns {Promise<{ accessToken: string, accessExpiresAt: Date, refreshToken: string, refreshExpiresAt: Date, refreshTokenId: string }>}
 */
async function issueTokens(
  { orgId, userId, role, familyId, absoluteExpiresAt, tokenId },
  { session, now },
) {
  const raw = generateOpaqueToken();
  const idleExpiresAt = new Date(now.getTime() + durationToMs(env.JWT_REFRESH_IDLE_TTL));
  const refreshExpiresAt = idleExpiresAt < absoluteExpiresAt ? idleExpiresAt : absoluteExpiresAt;
  const doc = await refreshRepo.create(
    orgId,
    {
      _id: tokenId,
      userId,
      familyId,
      tokenHash: hashToken(raw),
      expiresAt: refreshExpiresAt,
      absoluteExpiresAt,
    },
    { session },
  );
  // The access token is capped to the remaining session life (SR-4 absolute limit).
  const accessMs = Math.max(
    1_000,
    Math.min(durationToMs(env.JWT_ACCESS_TTL), refreshExpiresAt.getTime() - now.getTime()),
  );
  const accessExpiresAt = new Date(now.getTime() + accessMs);
  const accessToken = signAccessToken(
    { userId, orgId, role },
    { ttl: `${Math.floor(accessMs / 1000)}s` },
  );
  return {
    accessToken,
    accessExpiresAt,
    refreshToken: raw,
    refreshExpiresAt,
    refreshTokenId: String(doc._id),
  };
}

/**
 * POST /api/auth/login. Every failure path returns the same AuthError so nothing leaks about
 * which organisation, email or password was wrong. A refresh token the browser still holds from a
 * previous session is revoked so re-login never leaves an orphaned family alive.
 * @param {{ orgSlug: string, email: string, password: string }} credentials
 * @param {{ presentedRefreshToken?: string }} [context]
 */
export async function login({ orgSlug, email, password }, { presentedRefreshToken } = {}) {
  const org = await orgRepo.findBySlug(orgSlug);
  const user = org ? await userRepo.findByEmailWithPassword(org._id, email) : null;
  const hashToCompare = user ? user.passwordHash : await DUMMY_HASH_PROMISE;
  const ok = await verifyPassword(password, hashToCompare);
  if (!user || !ok) {
    throw new AuthError(INVALID_CREDENTIALS);
  }
  if (typeof presentedRefreshToken === 'string' && presentedRefreshToken.length > 0) {
    const previous = await refreshRepo.findByHash(hashToken(presentedRefreshToken));
    if (previous && !previous.revokedAt) {
      await refreshRepo.revokeFamily(String(previous.orgId), previous.familyId);
    }
  }
  const tokens = await startSession(user);
  return { user: publicUser(user), ...tokens };
}

/**
 * POST /api/auth/refresh. Rotates the refresh token with one conditional update (no token can be
 * rotated twice, after revocation, or after expiry) and issues its successor in the same
 * transaction. A token that was already rotated is refused; if that happens outside the grace
 * window it is treated as theft and the whole family is revoked.
 * @param {string|undefined} rawRefreshToken
 */
export async function refresh(rawRefreshToken, { now = new Date() } = {}) {
  if (typeof rawRefreshToken !== 'string' || rawRefreshToken.length === 0) {
    throw new AuthError('Refresh token missing');
  }
  const presented = await refreshRepo.findByHash(hashToken(rawRefreshToken));
  if (!presented) {
    throw new AuthError(INVALID_REFRESH);
  }
  const orgId = String(presented.orgId);
  if (presented.revokedAt) {
    throw new AuthError(INVALID_REFRESH);
  }
  if (presented.replacedBy) {
    const usedAt = presented.lastUsedAt ? presented.lastUsedAt.getTime() : 0;
    if (now.getTime() - usedAt > REFRESH_REUSE_GRACE_MS) {
      const revoked = await refreshRepo.revokeFamily(orgId, presented.familyId);
      logger.warn(
        { orgId, userId: String(presented.userId), familyId: String(presented.familyId), revoked },
        'refresh token reuse detected; family revoked',
      );
    }
    throw new AuthError(INVALID_REFRESH);
  }
  if (presented.expiresAt <= now || presented.absoluteExpiresAt <= now) {
    throw new AuthError('Session expired');
  }
  const user = await userRepo.findById(orgId, presented.userId);
  if (!user) {
    await refreshRepo.revokeFamily(orgId, presented.familyId);
    throw new AuthError(INVALID_REFRESH);
  }

  return withTransaction(async (session) => {
    const successorId = new mongoose.Types.ObjectId();
    const rotated = await refreshRepo.markRotated(
      orgId,
      presented._id,
      { replacedBy: successorId, usedAt: now },
      { session },
    );
    if (!rotated) {
      // Lost a concurrent refresh of the same token, or it was revoked meanwhile. The other
      // request's successor (if any) is what the browser now holds; nothing to revoke here.
      throw new AuthError(INVALID_REFRESH);
    }
    const next = await issueTokens(
      {
        orgId,
        userId: String(user._id),
        role: user.role, // re-read from the DB so role changes propagate at the next refresh
        familyId: presented.familyId,
        absoluteExpiresAt: presented.absoluteExpiresAt,
        tokenId: successorId,
      },
      { session, now },
    );
    return { user: publicUser(user), ...next };
  });
}

/**
 * POST /api/auth/logout. Revokes the presented refresh token's family; the controller clears cookies.
 * Idempotent: an unknown or already-revoked token is not an error.
 * @param {{ userId: string, orgId: string }} auth
 * @param {string|undefined} rawRefreshToken
 */
export async function logout(auth, rawRefreshToken) {
  if (typeof rawRefreshToken === 'string' && rawRefreshToken.length > 0) {
    const presented = await refreshRepo.findByHash(hashToken(rawRefreshToken));
    if (
      presented &&
      String(presented.orgId) === String(auth.orgId) &&
      String(presented.userId) === String(auth.userId)
    ) {
      await refreshRepo.revokeFamily(auth.orgId, presented.familyId);
      return;
    }
  }
  // No usable refresh cookie: still end every session of this user so logout always means logout.
  await refreshRepo.revokeAllForUser(auth.orgId, auth.userId);
}

/**
 * GET /api/auth/me. Re-reads the user so a deleted user or changed role is reflected immediately.
 * @param {{ userId: string, orgId: string }} auth
 */
export async function me(auth) {
  const user = await userRepo.findById(auth.orgId, auth.userId);
  if (!user) {
    throw new AuthError('Session is no longer valid');
  }
  const org = await orgRepo.findById(auth.orgId);
  return {
    user: publicUser(user),
    organization: org ? { id: String(org._id), name: org.name, slug: org.slug } : null,
  };
}
