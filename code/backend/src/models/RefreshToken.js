// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: RefreshToken ("Session") schema: hashed opaque token, idle + absolute expiry, rotation family (SDD §6.2, SR-4)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The `refreshtokens` collection: one issued refresh token, stored only as a hash (SDD §6.2, SR-4).
 *
 * Each row is a single token in a rotation chain. Every token descending from one login shares a
 * `familyId`, and each rotation marks its predecessor with `replacedBy`. That chain is what makes
 * theft detectable: presenting a token that has already been rotated means two parties hold tokens
 * from the same family, so the whole family is revoked and both are logged out (see auth.service.js
 * for the grace window that keeps honest concurrent refreshes from tripping this).
 *
 * The two expiries do different jobs. `expiresAt` is the idle timeout and moves forward on each
 * rotation; `absoluteExpiresAt` is fixed at login and inherited unchanged by every rotation, capping
 * the total session life. The MongoDB TTL index is on the *absolute* one, so a rotated-away token
 * survives long enough to still be recognised as reuse for the family's whole life.
 *
 * Only `tokenHash` is stored; the raw value exists solely in the client's cookie.
 */
import mongoose from 'mongoose';
import { createSchema, ObjectId, orgIdField } from './base.js';

const refreshTokenSchema = createSchema(
  {
    orgId: orgIdField,
    userId: { type: ObjectId, required: true, immutable: true },
    // All tokens descending from one login share a family; reuse of a rotated token revokes the family.
    familyId: { type: ObjectId, required: true, immutable: true },
    // SHA-256 of the opaque value handed to the client. The raw value is never stored.
    tokenHash: { type: String, required: true, immutable: true },
    // Idle expiry: now + JWT_REFRESH_IDLE_TTL at issue time, capped by absoluteExpiresAt.
    expiresAt: { type: Date, required: true },
    // Absolute expiry: login time + JWT_REFRESH_ABSOLUTE_TTL, inherited by every rotation. TTL-indexed.
    absoluteExpiresAt: { type: Date, required: true, immutable: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: ObjectId, default: null },
  },
  { collection: 'refreshtokens' },
);

/**
 * Is this token still usable right now?
 *
 * True only when it has not been explicitly revoked, has not been rotated away (`replacedBy`), and
 * is inside both the idle and the absolute window. A virtual rather than a stored field, so it can
 * never go stale.
 */
refreshTokenSchema.virtual('isActive').get(function isActive() {
  const now = Date.now();
  return (
    this.revokedAt === null &&
    this.replacedBy === null &&
    this.expiresAt.getTime() > now &&
    this.absoluteExpiresAt.getTime() > now
  );
});

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const RefreshToken =
  mongoose.models.RefreshToken ?? mongoose.model('RefreshToken', refreshTokenSchema);
