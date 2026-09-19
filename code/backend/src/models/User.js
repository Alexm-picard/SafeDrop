// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: User schema with role enum, passwordHash never selected/serialised (SDD §2.4, SR-3); invitation token + expiry
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; extended for the invitation-link work. Must be reviewed and tested by the owning team member before merge.

/**
 * The `users` collection: a person within one organisation (SDD §2.4).
 *
 * A user belongs to exactly one organisation and holds exactly one role, which is the input to every
 * authorization decision (see utils/permissions.js). Email is stored lowercase and is unique *per
 * organisation* rather than globally (OD-3) — the uniqueness index is `{ orgId, email }` and lives in
 * migrations/ — which is why the same address can exist in two tenants and why login needs an org
 * slug to disambiguate.
 *
 * An invited member is created with **no usable password** (a hash of a random value nobody holds) and
 * an `inviteTokenHash` + `inviteExpiresAt`: they choose their own password by opening the invitation link,
 * which consumes the token and clears both fields. `inviteExpiresAt` set means the invitation is still
 * outstanding — pending until that instant, expired after it. The token itself is only ever stored as a
 * SHA-256 hash, like a refresh token, and is `select: false`.
 *
 * `passwordHash` is `select: false`, so it is absent from query results unless a repository asks for
 * it by name; only the login path does.
 */
import mongoose from 'mongoose';
import { ROLE_LIST, ROLES } from '../utils/permissions.js';
import { createSchema, orgIdField } from './base.js';

const userSchema = createSchema(
  {
    orgId: orgIdField,
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    // select:false → never returned unless a repository asks for it explicitly (login only).
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    role: { type: String, required: true, enum: ROLE_LIST, default: ROLES.MEMBER },
    // Present only while an invitation is outstanding. `inviteTokenHash` is unique (partial index in
    // migrations/) because the accept-invitation route finds the user by it alone.
    inviteTokenHash: { type: String, select: false },
    inviteExpiresAt: { type: Date },
  },
  { collection: 'users' },
);

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
