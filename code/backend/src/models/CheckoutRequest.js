// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: CheckoutRequest schema with the F4 state enum and decision/handoff timestamps (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import mongoose from 'mongoose';
import { REQUEST_STATE, REQUEST_STATE_LIST } from '../utils/constants.js';
import { createSchema, ObjectId, orgIdField } from './base.js';

const checkoutRequestSchema = createSchema(
  {
    orgId: orgIdField,
    unitId: { type: ObjectId, required: true, immutable: true },
    requesterId: { type: ObjectId, required: true, immutable: true },
    state: {
      type: String,
      required: true,
      enum: REQUEST_STATE_LIST,
      default: REQUEST_STATE.PENDING,
    },
    neededFrom: { type: Date, required: true },
    neededTo: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    decidedBy: { type: ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, maxlength: 1000, default: '' },
    checkedOutAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
  },
  { collection: 'checkoutrequests' },
);

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const CheckoutRequest =
  mongoose.models.CheckoutRequest ?? mongoose.model('CheckoutRequest', checkoutRequestSchema);
