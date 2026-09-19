// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: bcrypt login with constant-time fallback, access JWT capped to the session, race-safe rotating refresh-token family with reuse detection + grace window, logout (SDD §6.2, SR-3, SR-4); changePassword(); acceptInvite() for emailed invitations
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; changePassword and acceptInvite added afterwards. Must be reviewed and tested by the owning team member before merge.
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

/**
 * Authentication: login, refresh-token rotation, logout, and the current session (SDD §6.2, SR-3, SR-4).
 *
 * This is the security core of the backend. Four ideas shape it:
 *
 * **Failures are indistinguishable.** A wrong organisation, an unknown email and a wrong password all
 * produce the same `AuthError` with the same message, and login always runs a bcrypt comparison —
 * against a dummy hash when the user does not exist — so response *timing* cannot reveal which
 * addresses are registered either.
 *
 * **Refresh tokens rotate, and reuse is detectable.** Each refresh consumes its token and issues a
 * successor in the same family. Presenting an already-consumed token means two parties hold tokens
 * from one login, so the entire family is revoked and both are logged out — outside a short grace
 * window that absorbs honest concurrency (two tabs, two in-flight retries after the same 401).
 *
 * **Sessions have a hard ceiling.** The idle window moves forward on each rotation, but the absolute
 * expiry is fixed at login and inherited by every successor, and an access token is capped so it can
 * never outlive the refresh token that justified it.
 *
 * **Roles are re-read, not carried.** Rotation reads the user's role from the database, so a demotion
 * takes effect at the next refresh instead of lingering for the life of a token.
 *
 * **An invited member has no password until they choose one.** They are created with a hash of a random
 * value nobody holds, so `login` cannot succeed for them, and an emailed one-time link lets them set a
 * real one (`acceptInvite`), which signs them in. The link is a 256-bit random token stored only as a
 * hash, valid once and for `INVITE_TTL`.
 *
 * Exports: `hashPassword`, `verifyPassword`, `publicUser`, `startSession`, `login`, `refresh`,
 * `logout`, `me`, `changePassword`, `acceptInvite`, and `REFRESH_REUSE_GRACE_MS`.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { withTransaction } from '../config/db.js';
import * as orgRepo from '../repositories/organization.repository.js';
import * as refreshRepo from '../repositories/refreshToken.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import { BCRYPT_COST, PASSWORD_MAX_BYTES } from '../utils/constants.js';
import { durationToMs } from '../utils/duration.js';
import { AuthError, InvitationError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { generateOpaqueToken, hashToken, signAccessToken } from '../utils/tokens.js';

/**
 * How long after a token is rotated its reuse is still treated as innocent.
 *
 * Within this window a re-presented token is simply refused; outside it, the whole family is revoked
 * as theft. The window exists because honest clients do double-submit: two tabs, or two requests
 * retrying after the same 401, can present the same cookie moments apart. Either way the browser
 * already holds the successor, so refusing costs it nothing.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/**
 * A throwaway bcrypt hash, computed once at module load.
 *
 * When login finds no user, it compares the supplied password against this instead of returning
 * early. Both paths then do the same expensive work, so an attacker cannot tell a registered address
 * from an unregistered one by how long the answer takes. Computed once because bcrypt at cost 12 is
 * slow by design, and on a random value so it matches nothing.
 */
const DUMMY_HASH_PROMISE = bcrypt.hash(`dummy-${generateOpaqueToken()}`, BCRYPT_COST);

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_REFRESH = 'Invalid refresh token';

/**
 * Hash a password for storage, at the project's bcrypt cost.
 *
 * Passwords longer than 72 bytes are rejected rather than hashed. bcrypt silently ignores everything
 * past that limit, so a 100-character passphrase would be authenticated by its first 72 bytes alone —
 * refusing keeps "your whole password counts" true rather than quietly false.
 * @param {string} password
 * @returns {Promise<string>} the bcrypt hash
 * @throws {ValidationError} (400) when the password exceeds 72 bytes
 */
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

/**
 * Compare a password against a stored bcrypt hash.
 *
 * An over-long password returns false instead of throwing: on the login path the byte cap is not the
 * caller's business, and a distinct error there would be one more way to tell accounts apart.
 * @param {string} password
 * @param {string} passwordHash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, passwordHash) {
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}

/**
 * Project a user document down to the fields that may be sent to a client.
 *
 * An allow-list, not a deletion: fields are copied out by name, so a column added to the schema later
 * (a hash, a token, an internal flag) is not exposed by default. This is the shape the frontend's
 * `User` typedef expects.
 * @param {object} user a Mongoose user document
 * @returns {{ id: string, orgId: string, email: string, name: string, role: string, invitation: { status: 'PENDING'|'EXPIRED', expiresAt: Date }|null, createdAt: Date }}
 */
export function publicUser(user) {
  return {
    id: String(user._id),
    orgId: String(user.orgId),
    email: user.email,
    name: user.name,
    role: user.role,
    // Non-null only while an invitation is outstanding; the token itself is never exposed.
    invitation: user.inviteExpiresAt
      ? {
          status: user.inviteExpiresAt.getTime() > Date.now() ? 'PENDING' : 'EXPIRED',
          expiresAt: user.inviteExpiresAt,
        }
      : null,
    createdAt: user.createdAt,
  };
}

/**
 * Begin a brand-new session: a fresh refresh-token family and its first token pair.
 *
 * A new `familyId` is what makes this a new session rather than a continuation — reuse detection
 * operates per family, so sessions cannot interfere with each other. The absolute expiry is fixed
 * here, at login time, and every later rotation inherits it unchanged; that is the ceiling on how
 * long the session can live no matter how often it refreshes.
 *
 * Used by login and by the first-admin bootstrap in organization.service.
 * @param {{ _id: unknown, orgId: unknown, role: string }} user
 * @param {{ session?: import('mongoose').ClientSession, now?: Date }} [options]
 * @returns {Promise<{ accessToken: string, accessExpiresAt: Date, refreshToken: string, refreshExpiresAt: Date, refreshTokenId: string }>}
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
 * Mint one refresh token of a family plus a matching access token.
 *
 * The shared bottom of `startSession` and `refresh`. Two caps are applied here.
 *
 * The refresh token's expiry is the *earlier* of the idle window and the family's absolute expiry,
 * so a session near its ceiling cannot be extended past it by refreshing.
 *
 * The access token is then capped to the remaining refresh life (with a 1-second floor so the JWT is
 * never minted already expired). Without that, a 15-minute access token issued in the last minute of
 * a session would keep working for 14 minutes after the session had ended — the absolute limit would
 * not hold (SR-4).
 *
 * `tokenId` lets the caller pre-generate the successor's id, so a rotation can point the outgoing
 * token at its replacement inside one transaction.
 * @param {{ orgId: string, userId: string, role: string, familyId: unknown, absoluteExpiresAt: Date, tokenId?: unknown }} params
 * @param {{ session?: import('mongoose').ClientSession, now: Date }} context
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
 * Authenticate `orgSlug` + email + password and start a session (`POST /api/auth/login`).
 *
 * The organisation is resolved first, because email is unique only within one (OD-3). Then the user
 * is looked up *with* their hash, and a bcrypt comparison runs whether or not that lookup succeeded —
 * against `DUMMY_HASH_PROMISE` when it did not. Every failure raises the same error with the same
 * message, so neither the response nor its timing distinguishes an unknown organisation from an
 * unknown email from a wrong password.
 *
 * If the browser still holds a refresh token from an earlier session, that family is revoked: logging
 * in again should not leave a second live session behind that nobody can see or end.
 * @param {{ orgSlug: string, email: string, password: string }} credentials
 * @param {{ presentedRefreshToken?: string }} [context] the refresh cookie the browser sent, if any
 * @returns {Promise<{ user: object, accessToken: string, accessExpiresAt: Date, refreshToken: string, refreshExpiresAt: Date, refreshTokenId: string }>}
 * @throws {AuthError} (401) on any failure, always with the same message
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
 * Rotate a refresh token and issue its successor (`POST /api/auth/refresh`).
 *
 * The presented token is checked in order — exists, not revoked, not already rotated, not expired —
 * and the interesting case is "already rotated". That means someone is presenting a token that has
 * already been consumed. Inside `REFRESH_REUSE_GRACE_MS` of its use it is treated as an honest
 * double-submit and merely refused; outside, it is treated as theft: the whole family is revoked, so
 * the attacker and the legitimate user are both logged out, and the event is logged.
 *
 * A token whose user no longer exists also revokes the family — a deleted account should not keep a
 * refreshable session.
 *
 * The rotation itself is one conditional update inside a transaction (`markRotated`), so two
 * concurrent refreshes cannot both succeed; the loser gets `null` and a 401 rather than a second live
 * successor. The successor's id is generated up front so both rows can reference each other in that
 * same transaction, and the role is re-read from the database so a role change propagates here.
 * @param {string|undefined} rawRefreshToken the raw token from the refresh cookie
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ user: object, accessToken: string, accessExpiresAt: Date, refreshToken: string, refreshExpiresAt: Date, refreshTokenId: string }>}
 * @throws {AuthError} (401) when the token is missing, unknown, revoked, reused or expired
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
 * End the caller's session (`POST /api/auth/logout`); the controller clears the cookies.
 *
 * The presented token is only honoured when it actually belongs to the authenticated caller, so one
 * user cannot log another out by sending their cookie. When there is no usable refresh cookie, every
 * session of the caller is revoked instead — logout should always mean logout, and the alternative
 * (doing nothing) would leave a user who clicked "log out" still logged in elsewhere.
 *
 * Idempotent: an unknown or already-revoked token is not an error.
 * @param {{ userId: string, orgId: string }} auth the verified caller
 * @param {string|undefined} rawRefreshToken the refresh cookie, if the browser sent one
 * @returns {Promise<void>}
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
 * Return the caller's user and organisation (`GET /api/auth/me`).
 *
 * Both are re-read from the database rather than reported from the token, so a deleted account or a
 * changed role shows up immediately instead of at the next refresh. A user who no longer exists gets
 * a 401, which is how the frontend learns to send them back to the login page.
 * @param {{ userId: string, orgId: string }} auth the verified caller
 * @returns {Promise<{ user: object, organization: { id: string, name: string, slug: string }|null }>}
 * @throws {AuthError} (401) when the user no longer exists
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

// AI-ASSISTED: YES
//   Tool: Claude Code
//   Prompt Summary: "Let a signed-in user replace their password (current password required, other
//   sessions ended, only a hash stored)."
//   AI Contribution: Initial draft and tests (~100% of the first version).
//   Modifications: none yet — pending review by the owning team member.
//   Verification:
//   - Integration tests (tests/integration/routes/changePassword.test.js)
//   Confidence: Medium-High; the Security lead should review session handling after a change.
/**
 * Replace the caller's password (`POST /api/auth/change-password`) and start a fresh session.
 *
 * The rules, and why:
 *
 *  - **The current password is required**, so a session left open at an unattended desk cannot be used
 *    to take over the account. A wrong one is a **400 with a field error**, not a 401: the SPA treats
 *    any 401 as "your session died", tries a refresh and, failing that, signs the user out — which is
 *    the wrong response to a typo. Brute-forcing is bounded by the auth rate limiter, which counts
 *    failed attempts on every `/api/auth` route.
 *  - **The new password must differ** from the current one.
 *  - **Only a bcrypt hash of the new password is stored**; it exists in plaintext only in this request.
 *  - **Every other session ends.** All the user's refresh tokens are revoked and a new session is
 *    started, in one transaction with the password update, so anyone else holding a session for the
 *    account is signed out.
 *
 * The new password's strength rules (length, 72-byte cap) are enforced by the route's schema.
 * @param {{ userId: string, orgId: string }} auth the verified caller
 * @param {{ currentPassword: string, newPassword: string }} input
 * @returns {Promise<{ user: object, accessToken: string, accessExpiresAt: Date, refreshToken: string, refreshExpiresAt: Date, refreshTokenId: string }>}
 * @throws {AuthError} (401) when the user no longer exists
 * @throws {ValidationError} (400) when the current password is wrong, or the new one is unchanged
 */
export async function changePassword(auth, { currentPassword, newPassword }) {
  const user = await userRepo.findByIdWithPassword(auth.orgId, auth.userId);
  if (!user) {
    throw new AuthError('Session is no longer valid');
  }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ValidationError('Invalid request', [
      { location: 'body', path: 'currentPassword', message: 'is incorrect' },
    ]);
  }
  if (newPassword === currentPassword) {
    throw new ValidationError('Invalid request', [
      {
        location: 'body',
        path: 'newPassword',
        message: 'must be different from your current password',
      },
    ]);
  }
  const passwordHash = await hashPassword(newPassword);

  return withTransaction(async (session) => {
    const updated = await userRepo.setPassword(auth.orgId, auth.userId, passwordHash, { session });
    await refreshRepo.revokeAllForUser(auth.orgId, auth.userId, { session });
    const tokens = await startSession(updated, { session });
    return { user: publicUser(updated), ...tokens };
  });
}

// AI-ASSISTED: YES
//   Tool: Claude Code
//   Prompt Summary: "Emailed one-time invitation link: the invitee opens it and chooses their own
//   password, which signs them in; single-use; expires after 72 hours."
//   AI Contribution: Initial draft and tests (~100% of the first version).
//   Modifications: none yet — pending review by the owning team member.
//   Verification:
//   - Integration tests (tests/integration/routes/invitations.test.js), including a concurrent
//     double-use test and expiry
//   Confidence: Medium-High; the Security lead should review token handling and the tenant-less lookup.
/**
 * Accept an invitation (`POST /api/auth/accept-invite`): set a password and sign in.
 *
 * Public, because the invitee has no account to authenticate with yet — the **token is the credential**.
 * It is 256 bits from the CSPRNG, so it cannot be guessed, and only its SHA-256 hash is stored, so a
 * database leak cannot be replayed as an invitation. Failed attempts count against the auth rate
 * limiter like any other guess at a credential.
 *
 * What can go wrong is told apart, because recovery differs: a token that matches nobody (mistyped, or
 * already used — using it removes it) is `INVITATION_INVALID`; one that matches but is past its expiry
 * is `INVITATION_EXPIRED`, and the admin should send a new link.
 *
 * The link is **single-use, enforced by the database**: consuming it is one conditional update that
 * requires the exact token and an unexpired invitation, so if it is opened twice at once exactly one
 * request activates the account and the other finds the token gone.
 *
 * The password is hashed *outside* the transaction (never hold one open across bcrypt), and the user is
 * signed in on success so they land in the app rather than at a login form asking for an organisation
 * code they may not know. The organisation is returned so the SPA can show that code for next time.
 * @param {{ token: string, password: string }} input validated by the route's schema
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ user: object, organization: { id: string, name: string, slug: string }, accessToken: string, accessExpiresAt: Date, refreshToken: string, refreshExpiresAt: Date, refreshTokenId: string }>}
 * @throws {InvitationError} (400) `INVITATION_INVALID` or `INVITATION_EXPIRED`
 */
export async function acceptInvite({ token, password }, { now = new Date() } = {}) {
  const tokenHash = hashToken(token);
  const invited = await userRepo.findByInviteTokenHash(tokenHash);
  if (!invited) {
    throw new InvitationError(
      'INVITATION_INVALID',
      'This invitation link is not valid, or has already been used',
    );
  }
  if (invited.inviteExpiresAt.getTime() <= now.getTime()) {
    throw new InvitationError(
      'INVITATION_EXPIRED',
      'This invitation has expired. Ask your administrator to send you a new one',
    );
  }
  const orgId = String(invited.orgId);
  const passwordHash = await hashPassword(password);

  return withTransaction(async (session) => {
    const user = await userRepo.acceptInvite(orgId, invited._id, tokenHash, passwordHash, {
      now,
      session,
    });
    if (!user) {
      // Lost a race: the same link was used a moment ago, or it expired while we were hashing.
      throw new InvitationError(
        'INVITATION_INVALID',
        'This invitation link is not valid, or has already been used',
      );
    }
    const org = await orgRepo.findById(orgId);
    const tokens = await startSession(user, { session, now });
    return {
      user: publicUser(user),
      organization: org ? { id: String(org._id), name: org.name, slug: org.slug } : null,
      ...tokens,
    };
  });
}
