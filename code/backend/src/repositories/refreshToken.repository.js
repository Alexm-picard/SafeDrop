// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: refresh-token family persistence for race-safe rotation and reuse detection (SDD §6.2, SR-4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import mongoose from 'mongoose';
import { RefreshToken } from '../models/RefreshToken.js';

/**
 * @param {string} orgId
 * @param {{ _id?: unknown, userId: string, familyId: string, tokenHash: string, expiresAt: Date, absoluteExpiresAt: Date }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
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
 * The one lookup without an orgId parameter: the refresh endpoint is public and the hashed token
 * (256 random bits) is itself the credential. The tenant is read from the stored document.
 */
export async function findByHash(tokenHash, { session } = {}) {
  return RefreshToken.findOne({ tokenHash }).session(session ?? null);
}

/**
 * Consume a token by rotation, atomically: succeeds only if the token is still unrotated, unrevoked
 * and unexpired at `usedAt`. Returns null when it lost a concurrent race or was revoked meanwhile.
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

/** Revoke every unrevoked token in a family (reuse detected, logout, or re-login). */
export async function revokeFamily(orgId, familyId, { session } = {}) {
  const result = await RefreshToken.updateMany(
    { orgId, familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { session },
  );
  return result.modifiedCount;
}

export async function revokeAllForUser(orgId, userId, { session } = {}) {
  const result = await RefreshToken.updateMany(
    { orgId, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { session },
  );
  return result.modifiedCount;
}

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
