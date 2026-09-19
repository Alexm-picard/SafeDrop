// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: refresh-token family persistence for race-safe rotation and reuse detection (SDD §6.2, SR-4)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Data access for the `refreshtokens` collection — the storage half of session rotation (SR-4).
 *
 * The rules about *when* to rotate or revoke live in services/auth.service.js; this file provides the
 * atomic operations those rules are built from. Two details matter throughout:
 *
 *  - Filters that the server builds with query operators (`$gt` on the expiries) are wrapped in
 *    `mongoose.trusted()`, because `sanitizeFilter` is on globally and would otherwise strip them.
 *  - `markRotated` is deliberately a single conditional update rather than a read-then-write, so
 *    concurrent refreshes cannot both consume the same token.
 *
 * Exports: `create`, `findByHash`, `markRotated`, `revokeFamily`, `revokeAllForUser`,
 * `countActiveForUser`.
 */
import mongoose from 'mongoose';
import { RefreshToken } from '../models/RefreshToken.js';

/**
 * Store a newly issued refresh token.
 *
 * Only the hash is passed in; the raw value never reaches this layer. `_id` may be supplied so the
 * caller can generate the id up front and point the outgoing token's predecessor at it inside the
 * same transaction — rotation needs both rows to reference each other.
 * @param {string} orgId
 * @param {{ _id?: unknown, userId: string, familyId: string, tokenHash: string, expiresAt: Date, absoluteExpiresAt: Date }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document>}
 */
export async function create(
  orgId,
  { _id, userId, familyId, tokenHash, expiresAt, absoluteExpiresAt },
  { session } = {},
) {
  const [doc] = await RefreshToken.create(
    [{ ...(_id ? { _id } : {}), orgId, userId, familyId, tokenHash, expiresAt, absoluteExpiresAt }],
    { session },
  );
  return doc;
}

/**
 * Look up a stored token by its hash.
 *
 * The one lookup with no `orgId` parameter, and deliberately so: the refresh endpoint is public and
 * the token — 256 bits of randomness — is itself the credential, so there is no verified tenant yet.
 * The tenant is read *from* the stored document and used to scope everything that follows.
 *
 * Note that this returns revoked, rotated and expired rows too. The caller needs them: a token that
 * is no longer active is exactly what reuse detection is looking for.
 * @param {string} tokenHash
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findByHash(tokenHash, { session } = {}) {
  return RefreshToken.findOne({ tokenHash }).session(session ?? null);
}

/**
 * Consume a token by rotation, atomically.
 *
 * The filter carries every precondition — not yet rotated, not revoked, and inside both the idle and
 * absolute windows at `usedAt` — so the database decides the winner of a concurrent refresh. A
 * `null` return is therefore meaningful rather than an error: this caller lost the race or the token
 * was revoked in the meantime, and auth.service decides whether that is an honest double-submit or
 * token theft.
 * @param {string} orgId
 * @param {string} tokenId
 * @param {{ replacedBy: unknown, usedAt?: Date }} rotation the successor token's id, and the instant to test the expiries against
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>} the consumed token, or null if it was not consumable
 */
export async function markRotated(
  orgId,
  tokenId,
  { replacedBy, usedAt = new Date() },
  { session } = {},
) {
  return RefreshToken.findOneAndUpdate(
    {
      _id: tokenId,
      orgId,
      replacedBy: null,
      revokedAt: null,
      // sanitizeFilter is on globally; operators we build ourselves must be marked trusted.
      expiresAt: mongoose.trusted({ $gt: usedAt }),
      absoluteExpiresAt: mongoose.trusted({ $gt: usedAt }),
    },
    { $set: { replacedBy, lastUsedAt: usedAt } },
    { returnDocument: 'after', session },
  );
}

/**
 * Revoke every still-active token descending from one login.
 *
 * This is the response to detected reuse — if two parties hold tokens from the same family, one of
 * them is an attacker and neither may continue — and it is also used at logout and on re-login.
 * Already-revoked rows are skipped so the recorded `revokedAt` stays the time of the first
 * revocation.
 * @param {string} orgId
 * @param {string} familyId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<number>} how many tokens were revoked
 */
export async function revokeFamily(orgId, familyId, { session } = {}) {
  const result = await RefreshToken.updateMany(
    { orgId, familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { session },
  );
  return result.modifiedCount;
}

/**
 * Revoke every active token for one user, across all their sessions and devices.
 *
 * The blunt instrument, for "log out everywhere": a compromised account, or a role change that
 * should not wait for existing access tokens to expire.
 * @param {string} orgId
 * @param {string} userId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<number>} how many tokens were revoked
 */
export async function revokeAllForUser(orgId, userId, { session } = {}) {
  const result = await RefreshToken.updateMany(
    { orgId, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { session },
  );
  return result.modifiedCount;
}

/**
 * Count a user's currently usable refresh tokens — roughly, their live sessions.
 *
 * Active means all four conditions at once: not revoked, not rotated away, and inside both expiry
 * windows. Intended for diagnostics and future session limits; it is not part of the auth decision
 * path.
 * @param {string} orgId
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function countActiveForUser(orgId, userId) {
  const now = new Date();
  return RefreshToken.countDocuments({
    orgId,
    userId,
    revokedAt: null,
    replacedBy: null,
    expiresAt: mongoose.trusted({ $gt: now }),
    absoluteExpiresAt: mongoose.trusted({ $gt: now }),
  });
}
