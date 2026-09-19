// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped CheckoutRequest persistence (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Data access for the `checkoutrequests` collection (the borrowing workflow).
 *
 * Alongside the usual tenant-scoped reads, this repository owns `transition()`, the conditional
 * write that makes the request state machine safe under concurrency.
 *
 * Exports: `create`, `findById`, `listForRequester`, `list`, `transition`.
 */
import { CheckoutRequest } from '../models/CheckoutRequest.js';

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