// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: CheckoutRequest schema with the F4 state enum and decision/handoff timestamps (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The `checkoutrequests` collection: one member's request to borrow one unit (SDD §2.4).
 *
 * This is the workflow document. It is created PENDING and moves through the state machine defined
 * in services/checkout.service.js — approved or denied, then checked out, then returned — and the
 * fields record who decided what and when: `decidedBy`/`decidedAt`/`decisionNote` for the decision,
 * `checkedOutAt`/`dueAt`/`returnedAt` for the handoff.
 *
 * Those fields are nullable because they are filled in as the request advances; which ones must be
 * set is decided by the transition rules in the service, not by the schema. `unitId` and
 * `requesterId` are immutable, so a request cannot be retargeted at another unit or person after the
 * fact — the audit trail would no longer describe what was approved.
 */
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
