// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Asset (catalogue entry) schema (SDD §2.4); requiredGroupId for restricted equipment (SCRUM-149)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18); requiredGroupId pending review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; extended for the restricted-equipment integration.

/**
 * The `assets` collection: a *kind* of item the organisation lends out (SDD §2.4).
 *
 * An Asset is the catalogue entry — "Dell XPS 15", "Canon EOS R6" — not a physical object. The
 * individual objects are AssetUnit documents pointing back at it, which is what lets several
 * identical items be tracked and checked out independently.
 *
 * Retirement is a soft delete: `retiredAt` is stamped rather than the row removed, so historical
 * requests and audit events still resolve to a real asset.
 */
import mongoose from 'mongoose';
import { APPROVAL_MODE, APPROVAL_MODE_LIST } from '../utils/constants.js';
import { createSchema, ObjectId, orgIdField } from './base.js';

const assetSchema = createSchema(
  {
    orgId: orgIdField,
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    category: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    imageUrl: { type: String, trim: true, maxlength: 2048, default: null },
    retiredAt: { type: Date, default: null },
    // SCRUM-148: per-asset override of the organisation's approval default. INHERIT defers to it.
    approvalMode: { type: String, enum: APPROVAL_MODE_LIST, default: APPROVAL_MODE.INHERIT },
    // Restricted equipment (SCRUM-149): when set, only an active member of this UserGroup may submit
    // a request for any unit of this asset — checked live in checkout.service.js's submit(), never
    // embedded in a token, so removing someone from the group takes effect on their very next request.
    // null means open to the whole organisation, the behaviour every asset had before this existed.
    requiredGroupId: { type: ObjectId, default: null },
  },
  { collection: 'assets' },
);

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const Asset = mongoose.models.Asset ?? mongoose.model('Asset', assetSchema);
