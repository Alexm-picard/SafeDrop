// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped CheckoutRequest persistence (SDD §2.4)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Data access for the `checkoutrequests` collection (the borrowing workflow).
 *
 * Alongside the usual tenant-scoped reads, this repository owns `transition()`, the conditional
 * write that makes the request state machine safe under concurrency.
 *
 * The dashboard's three aggregate reads live here too (`countByState`, `countOverdue`,
 * `countCheckoutsByDay`): they are counts over the whole collection rather than documents anyone
 * gets to see, so they never load requests into memory just to length them.
 *
 * Filters that this file builds with query operators are wrapped in `mongoose.trusted()`, because
 * `sanitizeFilter` is on globally (config/db.js) and would otherwise neutralise them — an overdue
 * count that silently returned zero would be worse than one that failed.
 *
 * Exports: `create`, `findById`, `listForRequester`, `list`, `listIdsForUnits`, `transition`,
 * `countByState`, `countOverdue`, `countCheckoutsByDay`.
 */
import mongoose from 'mongoose';
import { CheckoutRequest } from '../models/CheckoutRequest.js';
import { REQUEST_STATE, REQUEST_STATE_LIST } from '../utils/constants.js';

/**
 * Open a new checkout request. It starts PENDING via the schema default.
 * @param {string} orgId
 * @param {{ unitId: string, requesterId: string, neededFrom: Date, neededTo: Date, note?: string }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document>}
 */
export async function create(
  orgId,
  { unitId, requesterId, neededFrom, neededTo, note },
  { session } = {},
) {
  const [doc] = await CheckoutRequest.create(
    [{ orgId, unitId, requesterId, neededFrom, neededTo, note }],
    {
      session,
    },
  );
  return doc;
}

/**
 * Fetch one request by id, scoped to the tenant.
 * @param {string} orgId
 * @param {string} requestId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findById(orgId, requestId, { session } = {}) {
  return CheckoutRequest.findOne({ _id: requestId, orgId }).session(session ?? null);
}

/**
 * List one member's own requests, newest first, optionally filtered by state — the "My requests" view.
 *
 * Scoped by `requesterId` as well as tenant, which is how the `requests:read:own` permission is
 * honoured at the data layer rather than by filtering after the fact.
 * @param {string} orgId
 * @param {string} requesterId
 * @param {{ state?: string, page?: number, limit?: number }} [options]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function listForRequester(orgId, requesterId, { state, page = 1, limit = 50 } = {}) {
  const filter = { orgId, requesterId };
  if (state) {
    filter.state = state;
  }
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    CheckoutRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    CheckoutRequest.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

/**
 * List every request in the organisation, newest first, optionally filtered by state.
 *
 * Backs the approval queue (`state=PENDING`), so it is reachable only with `requests:decide`.
 * @param {string} orgId
 * @param {{ state?: string, page?: number, limit?: number }} [query]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function list(orgId, { state, page = 1, limit = 50 } = {}) {
  const filter = { orgId };
  if (state) {
    filter.state = state;
  }
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    CheckoutRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    CheckoutRequest.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

/**
 * The ids of every request ever made for any of `unitIds` (SCRUM-29).
 *
 * Ids only, because the caller wants them as audit targets rather than as requests to display —
 * loading whole documents to read one field off each would pull a unit's entire borrowing history
 * into memory to build a list of object ids. Unbounded on purpose for the same reason: this has to
 * be *every* request, or the asset's history would silently begin partway through, and the rows it
 * returns are 12 bytes each.
 *
 * Not filtered by state: a denied or cancelled request is part of what happened to the asset, and an
 * investigation into a missing item is exactly when a refused request matters.
 * @param {string} orgId
 * @param {unknown[]} unitIds units of one asset, already resolved within this tenant
 * @returns {Promise<import('mongoose').Types.ObjectId[]>}
 */
export async function listIdsForUnits(orgId, unitIds) {
  if (unitIds.length === 0) {
    return [];
  }
  // `sanitizeFilter` is on globally and rewrites operators it did not put there; this one is ours.
  const docs = await CheckoutRequest.find({
    orgId,
    unitId: mongoose.trusted({ $in: unitIds }),
  }).select('_id');
  return docs.map((doc) => doc._id);
}

/**
 * Apply a state transition as a single conditional write.
 *
 * `expectedState` is part of the filter, so the update is a compare-and-set: two approvers clicking
 * at the same moment cannot both succeed, because the second no longer matches the state it expected
 * and gets `null` back. Validating the transition first (in checkout.service) and then writing
 * unconditionally would leave exactly that race open.
 * @param {string} orgId
 * @param {string} requestId
 * @param {{ expectedState: string, patch: Record<string, unknown> }} change the state required before the write, and the fields to set
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>} the updated request, or null if it had already moved on
 */
export async function transition(orgId, requestId, { expectedState, patch }, { session } = {}) {
  return CheckoutRequest.findOneAndUpdate(
    { _id: requestId, orgId, state: expectedState },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  );
}

/**
 * Count requests per state for one tenant — the pending figure on the admin dashboard.
 *
 * Mirrors `assetUnit.repository.countByStatus`: the aggregation returns only the states that occur,
 * so the result is merged onto a zero-filled map of every state and a caller can read
 * `counts.PENDING` without checking whether the key exists. `orgId` is cast explicitly because an
 * aggregation `$match` gets no schema casting, and a string would match nothing.
 * @param {string} orgId
 * @returns {Promise<Record<string, number>>} every state key, zero when absent
 */
export async function countByState(orgId) {
  const rows = await CheckoutRequest.aggregate([
    { $match: { orgId: new mongoose.Types.ObjectId(String(orgId)) } },
    { $group: { _id: '$state', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(REQUEST_STATE_LIST.map((state) => [state, 0]));
  for (const row of rows) {
    counts[row._id] = row.count;
  }
  return counts;
}

/**
 * Count the checkouts that are still out and whose due date has passed (SCRUM-102, AT1).
 *
 * "Still out" is CHECKED_OUT or OVERDUE: those are the two states in which the organisation does not
 * have the item back. RETURNED and LOST are excluded — a late return that has arrived is no longer
 * something the admin can chase, and a lost item is a different problem with its own state.
 *
 * A request with no `dueAt` cannot be counted: MongoDB compares within a BSON type, so null never
 * matches `$lt: <date>`. That is the intended reading — a request that was never handed over has no
 * due date to be late against.
 * @param {string} orgId
 * @param {Date} [asOf] the instant to measure lateness against; defaults to now
 * @returns {Promise<number>}
 */
export async function countOverdue(orgId, asOf = new Date()) {
  return CheckoutRequest.countDocuments({
    orgId,
    state: mongoose.trusted({ $in: [REQUEST_STATE.CHECKED_OUT, REQUEST_STATE.OVERDUE] }),
    dueAt: mongoose.trusted({ $lt: asOf }),
  });
}

/**
 * Count checkouts per calendar day over a window — the dashboard's activity chart.
 *
 * Grouped by `checkedOutAt`, the moment the item physically changed hands, which is what "checkout
 * activity" means; the request's own creation date would count intent rather than movement. Days are
 * UTC so that the buckets do not shift with the server's timezone, and the caller zero-fills the days
 * that produced no rows.
 * @param {string} orgId
 * @param {{ from: Date, to: Date }} window half-open: `from` included, `to` excluded
 * @returns {Promise<Record<string, number>>} `YYYY-MM-DD` → count, only for days with checkouts
 */
export async function countCheckoutsByDay(orgId, { from, to }) {
  const rows = await CheckoutRequest.aggregate([
    {
      $match: {
        orgId: new mongoose.Types.ObjectId(String(orgId)),
        checkedOutAt: { $gte: from, $lt: to },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$checkedOutAt', timezone: 'UTC' } },
        count: { $sum: 1 },
      },
    },
  ]);
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}
