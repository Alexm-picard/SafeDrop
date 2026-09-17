// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Asset (catalogue entry) schema (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import mongoose from 'mongoose';
import { createSchema, orgIdField } from './base.js';

const assetSchema = createSchema(
  {
    orgId: orgIdField,
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    category: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    imageUrl: { type: String, trim: true, maxlength: 2048, default: null },
    retiredAt: { type: Date, default: null },
  },
  { collection: 'assets' },
);

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const Asset = mongoose.models.Asset ?? mongoose.model('Asset', assetSchema);
