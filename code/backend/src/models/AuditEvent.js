// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: append-only AuditEvent schema; server-set timestamp on every insert path; every update/delete/aggregate-write path throws (SDD §2.5, SR-8, SR-9, SR-10)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import mongoose from 'mongoose';
import { AUDIT_ACTION_LIST, AUDIT_TARGET_TYPE_LIST } from '../utils/constants.js';
import { ROLE_LIST } from '../utils/permissions.js';
import { createSchema, ObjectId, orgIdField } from './base.js';

export class AuditImmutabilityError extends Error {
  constructor(operation) {
    super(`Audit events are append-only; "${operation}" is not allowed (SR-8)`);
    this.name = 'AuditImmutabilityError';
    this.code = 'AUDIT_IMMUTABLE';
  }
}

const auditEventSchema = createSchema(
  {
    orgId: orgIdField,
    actorId: { type: ObjectId, required: true, immutable: true },
    actorRole: { type: String, required: true, enum: ROLE_LIST, immutable: true },
    action: { type: String, required: true, enum: AUDIT_ACTION_LIST, immutable: true },
    targetType: { type: String, required: true, enum: AUDIT_TARGET_TYPE_LIST, immutable: true },
    targetId: { type: ObjectId, required: true, immutable: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    after: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    // Always server-set (see the save/insertMany hooks); a client-supplied value is overwritten.
    timestamp: { type: Date, default: () => new Date(), immutable: true },
    requestId: { type: String, default: null, immutable: true },
  },
  {
    collection: 'auditevents',
    timestamps: false,
    // Unknown fields are an error, not silently dropped: an audit row must be exactly what we defined.
    strict: 'throw',
  },
);

// ---- Timestamp is the server's, on every insert path ---------------------------------------------
auditEventSchema.pre('save', function stampAndRejectResave() {
  if (!this.isNew) {
    throw new AuditImmutabilityError('save');
  }
  this.timestamp = new Date();
});
auditEventSchema.pre('insertMany', function stampInsertMany(...args) {
  const docs = args.find(Array.isArray) ?? [];
  const now = new Date();
  for (const doc of docs) {
    if (doc && typeof doc === 'object') {
      doc.timestamp = now;
    }
  }
  const next = args.find((arg) => typeof arg === 'function');
  if (next) {
    next();
  }
});

// ---- Immutability: every Mongoose path that could mutate or remove a row throws. -----------------
// (Anything that bypasses Mongoose entirely, e.g. Model.collection.updateOne, is banned by
// convention: auditEvent.repository.js exposes only append() and query(). CI review checklist item.)
const MUTATING_QUERY_HOOKS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];

auditEventSchema.pre(MUTATING_QUERY_HOOKS, function rejectMutation() {
  throw new AuditImmutabilityError(this.op ?? 'update');
});
auditEventSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function rejectDocumentDelete() {
    throw new AuditImmutabilityError('deleteOne');
  },
);
auditEventSchema.pre('bulkWrite', function rejectBulkWrite() {
  throw new AuditImmutabilityError('bulkWrite');
});
// Aggregation stages that write ($out/$merge) could rewrite the collection without any other hook.
auditEventSchema.pre('aggregate', function rejectWritingAggregation() {
  const pipeline = typeof this.pipeline === 'function' ? this.pipeline() : [];
  if (pipeline.some((stage) => stage && ('$out' in stage || '$merge' in stage))) {
    throw new AuditImmutabilityError('aggregate $out/$merge');
  }
});

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const AuditEvent =
  mongoose.models.AuditEvent ?? mongoose.model('AuditEvent', auditEventSchema);
