// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: the single F4 state-transition table + assertTransition guard with unit side-effects; transition handlers stubbed (SDD §8, arch review F4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { REQUEST_STATE as S, UNIT_STATUS as U } from '../utils/constants.js';
import { NotImplementedError, StateTransitionError } from '../utils/errors.js';

/**
 * THE state machine. Every handler below must go through assertTransition(); nothing else may
 * change CheckoutRequest.state. Each row lists the AssetUnit side-effect that happens in the same
 * transaction (NFR-2: a failed step never leaves a unit half-checked-out).
 *
 * from          → to           unit side-effect   audit action
 * PENDING       → APPROVED     unit HELD          REQUEST_APPROVED
 * PENDING       → DENIED       (none)             REQUEST_DENIED
 * PENDING       → CANCELLED    (none)             REQUEST_CANCELLED
 * APPROVED      → CANCELLED    unit AVAILABLE     REQUEST_CANCELLED
 * APPROVED      → CHECKED_OUT  unit OUT           ASSET_CHECKED_OUT
 * CHECKED_OUT   → RETURNED     unit AVAILABLE     ASSET_RETURNED
 * CHECKED_OUT   → OVERDUE      (none)             (system; Iteration 2 scheduler)
 * CHECKED_OUT   → LOST         unit RETIRED       (Iteration 2)
 * OVERDUE       → RETURNED     unit AVAILABLE     ASSET_RETURNED
 * OVERDUE       → LOST         unit RETIRED       (Iteration 2)
 */
export const TRANSITIONS = Object.freeze({
  [S.PENDING]: Object.freeze({
    [S.APPROVED]: Object.freeze({ unitStatus: U.HELD }),
    [S.DENIED]: Object.freeze({ unitStatus: null }),
    [S.CANCELLED]: Object.freeze({ unitStatus: null }),
  }),
  [S.APPROVED]: Object.freeze({
    [S.CANCELLED]: Object.freeze({ unitStatus: U.AVAILABLE }),
    [S.CHECKED_OUT]: Object.freeze({ unitStatus: U.OUT }),
  }),
  [S.CHECKED_OUT]: Object.freeze({
    [S.RETURNED]: Object.freeze({ unitStatus: U.AVAILABLE }),
    [S.OVERDUE]: Object.freeze({ unitStatus: null }),
    [S.LOST]: Object.freeze({ unitStatus: U.RETIRED }),
  }),
  [S.OVERDUE]: Object.freeze({
    [S.RETURNED]: Object.freeze({ unitStatus: U.AVAILABLE }),
    [S.LOST]: Object.freeze({ unitStatus: U.RETIRED }),
  }),
  // Terminal states: no outgoing transitions.
  [S.DENIED]: Object.freeze({}),
  [S.CANCELLED]: Object.freeze({}),
  [S.RETURNED]: Object.freeze({}),
  [S.LOST]: Object.freeze({}),
});

export const TERMINAL_STATES = Object.freeze(
  Object.keys(TRANSITIONS).filter((state) => Object.keys(TRANSITIONS[state]).length === 0),
);

/**
 * Guard used by every transition handler.
 * @param {string} from
 * @param {string} to
 * @returns {{ unitStatus: string|null }} the unit side-effect for this transition
 * @throws {StateTransitionError} for any pair not in the table (including unknown states)
 */
export function assertTransition(from, to) {
  // Own-property lookups only: 'constructor', '__proto__' etc. must never resolve to a row.
  const row = Object.hasOwn(TRANSITIONS, from) ? TRANSITIONS[from] : undefined;
  const effect = row && Object.hasOwn(row, to) ? row[to] : undefined;
  if (!effect) {
    throw new StateTransitionError(from, to);
  }
  return effect;
}

export function canTransition(from, to) {
  return Object.hasOwn(TRANSITIONS, from) && Object.hasOwn(TRANSITIONS[from], to);
}

// ---- Sprint 1 stubs. Each must: load the request by (orgId, id) → 404 if absent; assertTransition;
// ---- run the policy where relevant; update request + unit + audit inside ONE withTransaction(). ---

/** POST /api/requests — TODO(SCRUM-requests-create): unit must be AVAILABLE; appends REQUEST_SUBMITTED. */
export async function submit(_orgId, _actor, _input) {
  throw new NotImplementedError(
    'SCRUM-requests-create',
    'Submitting requests is not implemented yet',
  );
}

/** GET /api/requests — TODO(SCRUM-requests-list): MEMBER sees own; APPROVER/ORG_ADMIN see all. */
export async function list(_orgId, _actor, _query) {
  throw new NotImplementedError('SCRUM-requests-list', 'Listing requests is not implemented yet');
}

/** GET /api/requests/:id — TODO(SCRUM-requests-read): MEMBER may only read own → otherwise 404. */
export async function get(_orgId, _actor, _requestId) {
  throw new NotImplementedError('SCRUM-requests-read', 'Reading a request is not implemented yet');
}

/** POST /api/requests/:id/approve — TODO(SCRUM-requests-approve): policy.canDecide; PENDING → APPROVED; unit HELD. */
export async function approve(_orgId, _actor, _requestId, _input) {
  throw new NotImplementedError(
    'SCRUM-requests-approve',
    'Approving requests is not implemented yet',
  );
}

/** POST /api/requests/:id/deny — TODO(SCRUM-requests-deny): policy.canDecide; PENDING → DENIED. */
export async function deny(_orgId, _actor, _requestId, _input) {
  throw new NotImplementedError('SCRUM-requests-deny', 'Denying requests is not implemented yet');
}

/** POST /api/requests/:id/cancel — TODO(SCRUM-requests-cancel): requester only; PENDING/APPROVED → CANCELLED. */
export async function cancel(_orgId, _actor, _requestId) {
  throw new NotImplementedError(
    'SCRUM-requests-cancel',
    'Cancelling requests is not implemented yet',
  );
}

/** POST /api/requests/:id/checkout — TODO(SCRUM-requests-checkout): requests:handoff; APPROVED → CHECKED_OUT; sets dueAt. */
export async function checkout(_orgId, _actor, _requestId) {
  throw new NotImplementedError(
    'SCRUM-requests-checkout',
    'Checkout handoff is not implemented yet',
  );
}

/** POST /api/requests/:id/return — TODO(SCRUM-requests-return): requests:handoff; CHECKED_OUT/OVERDUE → RETURNED. */
export async function returnUnit(_orgId, _actor, _requestId, _input) {
  throw new NotImplementedError('SCRUM-requests-return', 'Return handoff is not implemented yet');
}
