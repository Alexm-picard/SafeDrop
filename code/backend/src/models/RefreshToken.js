// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: RefreshToken ("Session") schema: hashed opaque token, idle + absolute expiry, rotation family (SDD §6.2, SR-4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
