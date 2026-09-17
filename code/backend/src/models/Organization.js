// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Organization schema (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
