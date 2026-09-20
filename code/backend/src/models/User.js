// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: User schema with role enum, passwordHash never selected/serialised (SDD §2.4, SR-3)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The `users` collection: a person within one organisation (SDD §2.4).
 *
 * A user belongs to exactly one organisation and holds exactly one role, which is the input to every
 * authorization decision (see utils/permissions.js). Email is stored lowercase and is unique *per
 * organisation* rather than globally (OD-3) — the uniqueness index is `{ orgId, email }` and lives in
 * migrations/ — which is why the same address can exist in two tenants and why login needs an org
 * slug to disambiguate.
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
    // True while the account is using a password somebody else chose — the initial password an
    // admin set at invitation, or one they set again through a reset. The API refuses every route
    // but change-password until the person picks their own, so an admin never keeps working
    // knowledge of a member's credentials (SCRUM-22).
    mustChangePassword: { type: Boolean, required: true, default: false },
    // Password reset (SCRUM-22). Only the SHA-256 of the token is stored, so a database dump does
    // not hand anyone a working reset link, and both fields are select:false for the same reason
    // the password hash is. They are cleared the moment the reset is used, which is what makes a
    // link single-use.
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpiresAt: { type: Date, default: null, select: false },
  },
  { collection: 'users' },
);

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
