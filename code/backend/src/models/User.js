// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: User schema with role enum, passwordHash never selected/serialised (SDD §2.4, SR-3)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
  },
  { collection: 'users' },
);

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
