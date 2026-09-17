// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: AssetUnit (one physical item) schema with status enum (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import mongoose from 'mongoose';
import {
  ASSET_CONDITION,
  ASSET_CONDITION_LIST,
  UNIT_STATUS,
  UNIT_STATUS_LIST,
} from '../utils/constants.js';
import { createSchema, ObjectId, orgIdField } from './base.js';

const assetUnitSchema = createSchema(
  {
    orgId: orgIdField,
    assetId: { type: ObjectId, required: true, immutable: true },
    // Barcode / asset tag, unique per organization (index in migrations).
    tag: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
    serial: { type: String, trim: true, maxlength: 128, default: null },
    condition: { type: String, enum: ASSET_CONDITION_LIST, default: ASSET_CONDITION.GOOD },
    status: {
      type: String,
      required: true,
      enum: UNIT_STATUS_LIST,
      default: UNIT_STATUS.AVAILABLE,
    },
  },
  { collection: 'assetunits' },
);

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const AssetUnit = mongoose.models.AssetUnit ?? mongoose.model('AssetUnit', assetUnitSchema);
