// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped CheckoutRequest persistence (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { CheckoutRequest } from '../models/CheckoutRequest.js';

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

export async function findById(orgId, requestId, { session } = {}) {
  return CheckoutRequest.findOne({ _id: requestId, orgId }).session(session ?? null);
}

export async function listForRequester(orgId, requesterId, { page = 1, limit = 50 } = {}) {
  const filter = { orgId, requesterId };
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    CheckoutRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    CheckoutRequest.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

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
 * Apply a state transition. The caller (checkout.service) has already validated the transition;
 * `expectedState` makes the write conditional so two concurrent decisions cannot both succeed.
 */
export async function transition(orgId, requestId, { expectedState, patch }, { session } = {}) {
  return CheckoutRequest.findOneAndUpdate(
    { _id: requestId, orgId, state: expectedState },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  );
}
