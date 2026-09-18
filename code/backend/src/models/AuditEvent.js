// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: append-only AuditEvent schema; server-set timestamp on every insert path; every update/delete/aggregate-write path throws (SDD §2.5, SR-8, SR-9, SR-10)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The `auditevents` collection: the append-only record of who did what (SDD §2.5, SR-8, SR-9).
 *
 * The audit trail is only worth anything if it cannot be edited after the fact, so immutability is
 * enforced here in the model rather than left to the discipline of callers. Every field is
 * `immutable`, `strict: 'throw'` rejects a row carrying anything the schema does not define, and
 * pre-hooks make every Mongoose path that could change or remove a row throw `AuditImmutabilityError`
 * — updates, deletes, `bulkWrite`, and aggregations containing a writing `$out`/`$merge` stage.
 *
 * `timestamp` is always re-stamped by the server on insert, so a caller cannot backdate an event.
 *
 * The one remaining way around all of this is to bypass Mongoose entirely
 * (`Model.collection.updateOne`). That is barred by convention instead: auditEvent.repository.js
 * exposes only append and query, and it is a CI review checklist item.
 */
import mongoose from 'mongoose';
import { AUDIT_ACTION_LIST, AUDIT_TARGET_TYPE_LIST } from '../utils/constants.js';
import { ROLE_LIST } from '../utils/permissions.js';
import { createSchema, ObjectId, orgIdField } from './base.js';

/**
 * Raised by the hooks below when something tries to alter or remove an audit row.
 *
 * A plain `Error`, not an `AppError`: this is a programming mistake rather than a client-visible
 * failure, so it should surface as a 500 and an alert, never as a tidy 4xx.
 * @param {string} operation the Mongoose operation that was refused
 */
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

/**
 * On `save()`: refuse to re-save an existing document, and stamp the server's time on a new one.
 *
 * Re-saving is the ordinary way a document gets edited, so it has to be blocked even though every
 * path is `immutable`. The timestamp is overwritten rather than trusted, so a caller-supplied
 * `timestamp` cannot place an event at a time of its choosing.
 */
auditEventSchema.pre('save', function stampAndRejectResave() {
  if (!this.isNew) {
    throw new AuditImmutabilityError('save');
  }
  this.timestamp = new Date();
});
/**
 * The same server-side timestamping for the `insertMany()` path, which does not run `save` hooks.
 *
 * All documents in one batch share a single `now`, so a bulk append is ordered consistently.
 * The hook's arguments vary by Mongoose version and call shape, hence locating the document array
 * and the `next` callback by type rather than by position.
 */
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

/**
 * Refuse every query-level update and delete listed in `MUTATING_QUERY_HOOKS`.
 */
auditEventSchema.pre(MUTATING_QUERY_HOOKS, function rejectMutation() {
  throw new AuditImmutabilityError(this.op ?? 'update');
});
/**
 * Refuse the *document*-level `deleteOne()`, which is a separate hook from the query-level one
 * registered above and would otherwise slip through.
 */
auditEventSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function rejectDocumentDelete() {
    throw new AuditImmutabilityError('deleteOne');
  },
);
/**
 * Refuse `bulkWrite()`, which can carry update and delete operations that fire no other hook.
 */
auditEventSchema.pre('bulkWrite', function rejectBulkWrite() {
  throw new AuditImmutabilityError('bulkWrite');
});
/**
 * Refuse an aggregation that writes.
 *
 * Most aggregations are harmless reads, but a `$out` or `$merge` stage can rewrite the whole
 * collection without triggering any update or delete hook, so the pipeline is inspected for those
 * two stages specifically.
 */
auditEventSchema.pre('aggregate', function rejectWritingAggregation() {
  const pipeline = typeof this.pipeline === 'function' ? this.pipeline() : [];
  if (pipeline.some((stage) => stage && ('$out' in stage || '$merge' in stage))) {
    throw new AuditImmutabilityError('aggregate $out/$merge');
  }
});

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const AuditEvent =
  mongoose.models.AuditEvent ?? mongoose.model('AuditEvent', auditEventSchema);
