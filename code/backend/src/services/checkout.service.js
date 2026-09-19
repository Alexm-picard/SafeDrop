// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: the single F4 state-transition table + assertTransition guard with unit side-effects; approve()/deny()/list() implemented (SCRUM-requests-approve, SCRUM-requests-deny, SCRUM-requests-list)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The checkout state machine, and the request handlers built on it.
 *
 * `TRANSITIONS` is the authority on what a checkout request may do next. Every handler goes through
 * `assertTransition()`; nothing else may change `CheckoutRequest.state`. Keeping the table in one
 * place means the legal moves can be read — and tested — without tracing the code that performs them.
 *
 * Each transition also names the AssetUnit side-effect that happens with it: approving holds a unit,
 * checkout sends it out, returning or cancelling frees it. Both writes belong to the same transaction
 * as the state change and its audit event, so a failed step can never leave a unit half-checked-out
 * (NFR-2).
 *
 * `approve`/`deny` are implemented: load the request by (orgId, id) → 404 if absent, apply the
 * organisation's approval policy (separation of duties), assertTransition, then write request + unit
 * + audit inside one `withTransaction()`. `list()` is implemented too: it answers `GET /api/requests`
 * for every role, but which requests come back depends on the caller, not just their role — see its
 * own doc comment. The remaining handlers are still Sprint 1 stubs.
 *
 * Exports: `TRANSITIONS`, `TERMINAL_STATES`, `assertTransition`, `canTransition`, and the handlers
 * `submit`, `list`, `get`, `approve`, `deny`, `cancel`, `checkout`, `returnUnit`.
 */
import { withTransaction } from '../config/db.js';
import * as assetUnitRepo from '../repositories/assetUnit.repository.js';
import * as checkoutRequestRepo from '../repositories/checkoutRequest.repository.js';
import * as organizationRepo from '../repositories/organization.repository.js';
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
  REQUEST_STATE as S,
  UNIT_STATUS as U,
} from '../utils/constants.js';
import {
  ForbiddenError,
  NotFoundError,
  NotImplementedError,
  StateTransitionError,
} from '../utils/errors.js';
import { PERMISSIONS, roleHasPermission } from '../utils/permissions.js';
import * as auditService from './audit.service.js';
import { policyFor } from './policies/approvalPolicy.js';

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

/**
 * The states with no outgoing transitions: DENIED, CANCELLED, RETURNED, LOST.
 *
 * Derived from the table rather than listed separately, so it cannot fall out of step with it.
 */
export const TERMINAL_STATES = Object.freeze(
  Object.keys(TRANSITIONS).filter((state) => Object.keys(TRANSITIONS[state]).length === 0),
);

/**
 * Assert that `from → to` is a legal move, and return its unit side-effect.
 *
 * The guard every transition handler passes through. Lookups use `Object.hasOwn` rather than plain
 * property access so that inherited names — `constructor`, `__proto__`, `toString` — cannot resolve
 * to a row: with a plain lookup, a state string taken from client input could reach Object.prototype
 * and produce a truthy "transition" that was never in the table.
 * @param {string} from current state
 * @param {string} to requested state
 * @returns {{ unitStatus: string|null }} the unit status to apply alongside, or null when there is none
 * @throws {StateTransitionError} (409) for any pair not in the table, including unknown states
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

/**
 * Is `from → to` a legal move? The non-throwing form of `assertTransition`.
 *
 * For callers that need to *ask* rather than enforce — showing which buttons apply to a request, for
 * instance. Handlers use `assertTransition` instead, so an illegal move fails rather than being
 * skipped.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return Object.hasOwn(TRANSITIONS, from) && Object.hasOwn(TRANSITIONS[from], to);
}

/**
 * Open a checkout request (`POST /api/requests`) — not implemented yet.
 *
 * TODO(SCRUM-requests-create): the unit must be AVAILABLE at the moment of writing, and the request
 * is created PENDING with a REQUEST_SUBMITTED audit event in the same transaction.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function submit(_orgId, _actor, _input) {
  throw new NotImplementedError(
    'SCRUM-requests-create',
    'Submitting requests is not implemented yet',
  );
}

/**
 * List checkout requests (`GET /api/requests`).
 *
 * Every role holds `requests:read:own`, so nobody is blocked at the route — what differs is which
 * requests come back. Whether the caller sees the whole organisation is decided by two things
 * together, not by role alone: they must hold `requests:decide` (APPROVER, ORG_ADMIN) **and** have
 * explicitly asked for it with `scope: 'org'`. Omitted or `scope: 'own'` always means "my own
 * requests," for every role — that is what keeps an admin's "My requests" view showing their own
 * requests rather than the whole organisation's, even though the same admin can ask this same
 * endpoint for the organisation-wide view (the approval queue) by passing `scope: 'org'`.
 *
 * A caller who cannot decide requests but sends `scope: 'org'` anyway is not rejected — the flag is
 * simply ignored and they get their own requests, the same way a smuggled `orgId` elsewhere in the
 * API is ignored rather than treated as an error.
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {{ state?: string, page?: number, limit?: number, scope?: 'own'|'org' }} [query] validated `listQuery`
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function list(orgId, actor, query = {}) {
  const { state, page, limit, scope } = query;
  const wantsOrgWide =
    scope === 'org' && roleHasPermission(actor.role, PERMISSIONS.REQUESTS_DECIDE);
  if (wantsOrgWide) {
    return checkoutRequestRepo.list(orgId, { state, page, limit });
  }
  return checkoutRequestRepo.listForRequester(orgId, actor.userId, { state, page, limit });
}

/**
 * Read one checkout request (`GET /api/requests/:id`) — not implemented yet.
 *
 * TODO(SCRUM-requests-read): a MEMBER may read only their own; someone else's must answer 404, not
 * 403, since a 403 would confirm the request exists.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function get(_orgId, _actor, _requestId) {
  throw new NotImplementedError('SCRUM-requests-read', 'Reading a request is not implemented yet');
}

/**
 * Approve a request (`POST /api/requests/:id/approve`).
 *
 * Holds the unit for the requester: PENDING -> APPROVED, unit -> HELD, both in one transaction with
 * the REQUEST_APPROVED audit event (SR-9, NFR-2). Separation of duties (SDD §6.4) is enforced by the
 * organisation's approval policy before anything is written.
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {string} requestId
 * @param {{ note?: string, requestId?: string }} [input] validated `decisionBody`, plus the HTTP
 *   request id for audit correlation
 * @returns {Promise<object>} the approved request
 * @throws {NotFoundError} (404) no such request in this organisation
 * @throws {ForbiddenError} (403) actor's role can't decide, or actor is the requester
 * @throws {StateTransitionError} (409) the request isn't PENDING (including a lost race)
 */
export async function approve(orgId, actor, requestId, input = {}) {
  const request = await checkoutRequestRepo.findById(orgId, requestId);
  if (!request) {
    throw new NotFoundError('Request not found');
  }

  const org = await organizationRepo.findById(orgId);
  const decision = policyFor(org).canDecide(request, actor);
  if (!decision.allowed) {
    throw new ForbiddenError(decision.reason ?? 'Not allowed to decide this request');
  }

  const { unitStatus } = assertTransition(request.state, S.APPROVED);

  return withTransaction(async (session) => {
    const updated = await checkoutRequestRepo.transition(
      orgId,
      requestId,
      {
        expectedState: S.PENDING,
        patch: {
          state: S.APPROVED,
          decidedBy: actor.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? '',
        },
      },
      { session },
    );
    if (!updated) {
      // Someone else decided this request between our read and this write.
      throw new StateTransitionError(request.state, S.APPROVED);
    }

    await assetUnitRepo.updateStatus(orgId, updated.unitId, unitStatus, { session });

    await auditService.record(
      orgId,
      {
        actor,
        action: AUDIT_ACTION.REQUEST_APPROVED,
        targetType: AUDIT_TARGET_TYPE.CheckoutRequest,
        targetId: requestId,
        before: { state: S.PENDING },
        after: { state: S.APPROVED },
        requestId: input.requestId,
      },
      { session },
    );

    return updated;
  });
}

/**
 * Deny a request (`POST /api/requests/:id/deny`).
 *
 * PENDING -> DENIED with no unit side-effect — nothing was ever held — plus the REQUEST_DENIED
 * audit event in the same transaction. Same policy check and race protection as `approve`.
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {string} requestId
 * @param {{ note?: string, requestId?: string }} [input] validated `decisionBody`, plus the HTTP
 *   request id for audit correlation
 * @returns {Promise<object>} the denied request
 * @throws {NotFoundError} (404) no such request in this organisation
 * @throws {ForbiddenError} (403) actor's role can't decide, or actor is the requester
 * @throws {StateTransitionError} (409) the request isn't PENDING (including a lost race)
 */
export async function deny(orgId, actor, requestId, input = {}) {
  const request = await checkoutRequestRepo.findById(orgId, requestId);
  if (!request) {
    throw new NotFoundError('Request not found');
  }

  const org = await organizationRepo.findById(orgId);
  const decision = policyFor(org).canDecide(request, actor);
  if (!decision.allowed) {
    throw new ForbiddenError(decision.reason ?? 'Not allowed to decide this request');
  }

  assertTransition(request.state, S.DENIED);

  return withTransaction(async (session) => {
    const updated = await checkoutRequestRepo.transition(
      orgId,
      requestId,
      {
        expectedState: S.PENDING,
        patch: {
          state: S.DENIED,
          decidedBy: actor.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? '',
        },
      },
      { session },
    );
    if (!updated) {
      throw new StateTransitionError(request.state, S.DENIED);
    }

    await auditService.record(
      orgId,
      {
        actor,
        action: AUDIT_ACTION.REQUEST_DENIED,
        targetType: AUDIT_TARGET_TYPE.CheckoutRequest,
        targetId: requestId,
        before: { state: S.PENDING },
        after: { state: S.DENIED },
        requestId: input.requestId,
      },
      { session },
    );

    return updated;
  });
}

/**
 * Cancel a request (`POST /api/requests/:id/cancel`) — not implemented yet.
 *
 * TODO(SCRUM-requests-cancel): the requester only, from PENDING or APPROVED. Cancelling an APPROVED
 * request must return its held unit to AVAILABLE, or the unit stays reserved for a request nobody
 * will collect.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function cancel(_orgId, _actor, _requestId) {
  throw new NotImplementedError(
    'SCRUM-requests-cancel',
    'Cancelling requests is not implemented yet',
  );
}

/**
 * Hand the item over (`POST /api/requests/:id/checkout`) — not implemented yet.
 *
 * TODO(SCRUM-requests-checkout): requires `requests:handoff`; moves APPROVED → CHECKED_OUT, sets the
 * unit to OUT and stamps `dueAt` from the requested window.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function checkout(_orgId, _actor, _requestId) {
  throw new NotImplementedError(
    'SCRUM-requests-checkout',
    'Checkout handoff is not implemented yet',
  );
}

/**
 * Take the item back (`POST /api/requests/:id/return`) — not implemented yet.
 *
 * TODO(SCRUM-requests-return): requires `requests:handoff`; moves CHECKED_OUT or OVERDUE → RETURNED
 * and sets the unit back to AVAILABLE, recording any condition change.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function returnUnit(_orgId, _actor, _requestId, _input) {
  throw new NotImplementedError('SCRUM-requests-return', 'Return handoff is not implemented yet');
}
