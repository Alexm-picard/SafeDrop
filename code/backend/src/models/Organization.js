// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Organization schema (SDD §2.4)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The `organizations` collection: the tenant itself (SDD §2.4).
 *
 * An organisation is the root of every tenant boundary in SafeDrop — users, assets, requests and
 * audit events all hang off its `_id` via their `orgId`. It holds only a display `name` and a `slug`.
 *
 * The slug is the tenant's public handle: because email is unique *per organisation* (OD-3), login
 * takes `orgSlug` + email + password, and the slug is what selects the tenant. It is `immutable`, so
 * an established login identifier cannot be changed out from under its users, and it is matched
 * against `SLUG_PATTERN` so it stays URL-safe.
 */
import mongoose from 'mongoose';
import { SLUG_PATTERN } from '../utils/constants.js';
import { createSchema } from './base.js';

const organizationSchema = createSchema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    // URL-safe identifier used at login to pick the tenant (OD-3: email is unique per organization).
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: SLUG_PATTERN,
      immutable: true,
    },
  },
  { collection: 'organizations' },
);

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const Organization =
  mongoose.models.Organization ?? mongoose.model('Organization', organizationSchema);
