// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-206 story)
// AI-Assisted Areas: operational-telemetry schema for AI search; no query text and no user id by construction (SCRUM-206 AT-1–AT-3)
// Human Contributions: pending review
// Notes: Written for SCRUM-206. Must be reviewed and tested by the owning team member before merge.

/**
 * The `searchquerylogs` collection: one row per AI search, describing how the search *behaved* and
 * nothing about what was searched for (SCRUM-206).
 *
 * Lab 2 sketched this model holding the query text. services/ai/README.md later ruled that raw member
 * data is never logged, and this story settles the conflict in the README's favour. What is left is
 * operational telemetry — enough to see the fallback rate, latency and zero-result rate per
 * organisation — and the fields that would turn it into a record of what people searched for are
 * absent on purpose:
 *
 *  - **No query text, and nothing derived from it** (AT-2). Not raw, not hashed. Search queries are
 *    short and guessable ("projector"), so a plain hash of one is reversed by hashing a word list.
 *    There is simply no field for it, and `strict: 'throw'` means a caller that tries to add one gets
 *    an error instead of a silently dropped field — the same setting as the audit model.
 *  - **No user id** (AT-3). Organisation + timestamp + user is a search history. The audit log
 *    already covers actions that change state; a search changes nothing.
 *
 * `assetId` is set only for `kind: 'alternatives'` (SCRUM-151), where the "query" is an asset the
 * member was looking at. An asset id is the organisation's data, not something a member typed.
 *
 * Rows are deleted by a TTL index on `timestamp` after `SEARCH_LOG_RETENTION_DAYS` (AT-5). The index
 * lives in migrations/, like every other index (models/base.js explains why).
 */
import mongoose from 'mongoose';
import { SEARCH_FALLBACK_REASON_LIST, SEARCH_KIND_LIST } from '../utils/constants.js';
import { createSchema, ObjectId, orgIdField } from './base.js';

const count = { type: Number, required: true, min: 0, immutable: true };

const searchQueryLogSchema = createSchema(
  {
    orgId: orgIdField,
    // Always the server's time (see the hook below): it is what the TTL index deletes by, so a
    // caller-supplied value could keep a row past retention.
    timestamp: { type: Date, default: () => new Date(), immutable: true },
    kind: { type: String, required: true, enum: SEARCH_KIND_LIST, immutable: true },
    assetId: { type: ObjectId, default: null, immutable: true },
    aiAssisted: { type: Boolean, required: true, immutable: true },
    // `null` means the model's answer was used. Mongoose's enum check skips null, so it is not listed.
    fallbackReason: {
      type: String,
      enum: SEARCH_FALLBACK_REASON_LIST,
      default: null,
      immutable: true,
    },
    latencyMs: count,
    // How many catalogue entries were sent to the model; 0 when the model was never asked.
    candidateCount: count,
    // How many results the member was shown. 0 is the "zero-result" case the summary counts.
    resultCount: count,
  },
  {
    collection: 'searchquerylogs',
    timestamps: false,
    // Rows are never updated, so there is nothing for a version key to protect; without this every
    // row would also carry `__v`.
    versionKey: false,
    // A field the schema does not define is an error, not silently dropped: the absence of a query
    // or user field is the point of this model, so adding one must be a visible change here.
    strict: 'throw',
  },
);

/** Stamp the server's time on insert, so a row cannot be dated to dodge the retention window. */
searchQueryLogSchema.pre('save', function stampTimestamp() {
  if (this.isNew) {
    this.timestamp = new Date();
  }
});

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const SearchQueryLog =
  mongoose.models.SearchQueryLog ?? mongoose.model('SearchQueryLog', searchQueryLogSchema);
