// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: the single F4 state-transition table + assertTransition guard with unit side-effects; submit()/approve()/deny()/list()/get() implemented (SCRUM-requests-create, SCRUM-requests-approve, SCRUM-requests-deny, SCRUM-requests-list, SCRUM-123)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

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
 * `submit`/`approve`/`deny`/`checkout`/`returnUnit` are implemented; `get`/`list` are implemented too
 * (see their own doc comments for how visibility is scoped). `approve`/`deny` additionally apply the
 * organisation's approval policy (separation of duties); `checkout`/`returnUnit` do not — access to
 * them is gated entirely by the `requests:handoff` permission at the route (OD-4). `cancel` is still
 * a Sprint 1 stub (SCRUM-requests-cancel, tracked separately from SCRUM-requests-create).
 *
 * Exports: `TRANSITIONS`, `TERMINAL_STATES`, `assertTransition`, `canTransition`, and the handlers
 * `submit`, `list`, `get`, `approve`, `deny`, `cancel`, `checkout`, `returnUnit`.
 */
import { withTransaction } from '../config/db.js';
import * as assetRepo from '../repositories/asset.repository.js';
import * as assetUnitRepo from '../repositories/assetUnit.repository.js';
import * as checkoutRequestRepo from '../repositories/checkoutRequest.repository.js';
import * as organizationRepo from '../repositories/organization.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
  REQUEST_STATE as S,
  UNIT_STATUS as U,
} from '../utils/constants.js';
import {
  ConflictError,
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
 *
 * Reaching PENDING (submit()) has no row of its own here: opening a request does not touch the
 * unit at all. That is a deliberate, still-open gap, not an oversight — see submit()'s doc comment.
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
 * Open a checkout request (`POST /api/requests`).
 *
 * The unit must be AVAILABLE at the moment of writing: it is read and the request inserted inside
 * one `withTransaction()`, so a submit can never act on a stale read of a unit some other operation
 * (a retire, a concurrent approval on a different request) is changing at that instant.
 *
 * This does **not** stop two members from submitting separate PENDING requests against the same
 * still-AVAILABLE unit at the same moment — reaching PENDING has no unit side-effect (see the
 * TRANSITIONS table: a unit is only reserved on approval), so there is nothing to compare-and-set
 * against here. That is the same "what happens to sibling PENDING requests" question already open
 * since `approve()` shipped; this ticket does not resolve it, only the narrower race above.
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {{ unitId: string, neededFrom: Date, neededTo: Date, note?: string, requestId?: string }} [input]
 *   validated `createRequestBody`, plus the HTTP request id for audit correlation
 * @returns {Promise<object>} the new PENDING request
 * @throws {NotFoundError} (404) no such unit in this organisation
 * @throws {ConflictError} (409) the unit is not AVAILABLE
 */
export async function submit(orgId, actor, input = {}) {
  return withTransaction(async (session) => {
    const unit = await assetUnitRepo.findById(orgId, input.unitId, { session });
    if (!unit) {
      throw new NotFoundError('Unit not found');
    }
    if (unit.status !== U.AVAILABLE) {
      throw new ConflictError('That unit is no longer available');
    }

    const created = await checkoutRequestRepo.create(
      orgId,
      {
        unitId: input.unitId,
        requesterId: actor.userId,
        neededFrom: input.neededFrom,
        neededTo: input.neededTo,
        note: input.note ?? '',
      },
      { session },
    );

    await auditService.record(
      orgId,
      {
        actor,
        action: AUDIT_ACTION.REQUEST_SUBMITTED,
        targetType: AUDIT_TARGET_TYPE.CheckoutRequest,
        targetId: created._id,
        before: null,
        after: { state: S.PENDING, unitId: input.unitId },
        requestId: input.requestId,
      },
      { session },
    );

    return created;
  });
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
 * Read one checkout request with everything the detail screen shows (`GET /api/requests/:id`).
 *
 * Who may see it is decided the same way `list()` decides scope, and for the same reason: holding
 * `requests:decide` means the whole organisation's requests are your business, and everyone else
 * sees only their own.
 *
 * **Someone else's request is a 404, never a 403.** A 403 would confirm that the id exists, which
 * is exactly what a member probing for other people's requests wants to learn (SR-2). The same
 * answer covers an id from another organisation and an id that never existed.
 *
 * The asset, unit, requester and decider are read alongside the request because a detail screen
 * that showed raw ids would be useless, and four concurrent lookups are cheaper than four round
 * trips from the browser. Each is tenant-scoped in its own right, so a dangling reference resolves
 * to null rather than reaching across organisations.
 *
 * The timeline is derived from the request's own timestamps rather than from the audit log: the
 * audit trail needs `audit:read`, which a member does not hold, and the request document already
 * records when each transition happened.
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {string} requestId
 * @returns {Promise<{ request: object, asset: object|null, unit: object|null, requester: object|null, decidedBy: object|null, timeline: Array<{ at: Date, event: string }> }>}
 * @throws {NotFoundError} (404) when no such request is visible to this caller
 */
export async function get(orgId, actor, requestId) {
  const request = await checkoutRequestRepo.findById(orgId, requestId);
  const maySeeAny = roleHasPermission(actor.role, PERMISSIONS.REQUESTS_DECIDE);
  if (!request || (!maySeeAny && String(request.requesterId) !== String(actor.userId))) {
    throw new NotFoundError('Request not found');
  }

  const unit = await assetUnitRepo.findById(orgId, request.unitId);
  const [asset, requester, decidedBy] = await Promise.all([
    unit ? assetRepo.findById(orgId, unit.assetId) : null,
    userRepo.findById(orgId, request.requesterId),
    request.decidedBy ? userRepo.findById(orgId, request.decidedBy) : null,
  ]);

  return {
    request,
    asset,
    unit,
    requester: requester ? publicPerson(requester) : null,
    decidedBy: decidedBy ? publicPerson(decidedBy) : null,
    timeline: timelineOf(request),
  };
}

/**
 * The fields of a person the detail screen may show.
 *
 * An allow-list rather than the whole document: the requester's role or the date they joined is
 * nobody else's business on this screen, and copying by name means a field added to the user schema
 * later is not exposed here by accident.
 * @param {object} user
 * @returns {{ id: string, name: string, email: string }}
 */
function publicPerson(user) {
  return { id: String(user._id), name: user.name, email: user.email };
}

/**
 * Turn a request's timestamps into what happened to it, oldest first.
 *
 * Only entries whose timestamp exists are included, so the list reads as a history rather than a
 * form with blanks. `dueAt` is deliberately absent: it is a deadline, not something that happened,
 * and the screen shows it next to the state instead.
 * @param {object} request
 * @returns {Array<{ at: Date, event: string }>}
 */
function timelineOf(request) {
  const entries = [
    { at: request.createdAt, event: 'SUBMITTED' },
    {
      at: request.decidedAt,
      event: request.state === S.DENIED ? 'DENIED' : 'APPROVED',
    },
    { at: request.checkedOutAt, event: 'CHECKED_OUT' },
    { at: request.returnedAt, event: 'RETURNED' },
  ];
  // A cancellation leaves no timestamp of its own, so the document's last write is the best
  // evidence of when it happened. Only shown when the request actually is cancelled.
  if (request.state === S.CANCELLED) {
    entries.push({ at: request.updatedAt, event: 'CANCELLED' });
  }
  return entries.filter((entry) => Boolean(entry.at)).sort((a, b) => a.at - b.at);
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
 * Hand the item over (`POST /api/requests/:id/checkout`).
 *
 * APPROVED -> CHECKED_OUT, unit -> OUT, `dueAt` stamped from the request's own `neededTo` (OD-4:
 * gated by `requests:handoff` at the route, not by separation of duties — anyone holding that
 * permission may record a handoff). ASSET_CHECKED_OUT audit event in the same transaction.
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {string} requestId
 * @param {{ requestId?: string }} [input] the HTTP request id, for audit correlation
 * @returns {Promise<object>} the checked-out request
 * @throws {NotFoundError} (404) no such request in this organisation
 * @throws {StateTransitionError} (409) the request isn't APPROVED (including a lost race)
 */
export async function checkout(orgId, actor, requestId, input = {}) {
  const request = await checkoutRequestRepo.findById(orgId, requestId);
  if (!request) {
    throw new NotFoundError('Request not found');
  }

  const { unitStatus } = assertTransition(request.state, S.CHECKED_OUT);

  return withTransaction(async (session) => {
    const updated = await checkoutRequestRepo.transition(
      orgId,
      requestId,
      {
        expectedState: S.APPROVED,
        patch: {
          state: S.CHECKED_OUT,
          checkedOutAt: new Date(),
          dueAt: request.neededTo,
        },
      },
      { session },
    );
    if (!updated) {
      throw new StateTransitionError(request.state, S.CHECKED_OUT);
    }

    await assetUnitRepo.updateStatus(orgId, updated.unitId, unitStatus, { session });

    await auditService.record(
      orgId,
      {
        actor,
        action: AUDIT_ACTION.ASSET_CHECKED_OUT,
        targetType: AUDIT_TARGET_TYPE.AssetUnit,
        targetId: updated.unitId,
        before: { status: U.HELD },
        after: { status: unitStatus },
        requestId: input.requestId,
      },
      { session },
    );

    return updated;
  });
}

/**
 * Take the item back (`POST /api/requests/:id/return`).
 *
 * CHECKED_OUT or OVERDUE -> RETURNED, unit -> AVAILABLE, with any reported condition change recorded
 * in the same write. OVERDUE itself is Iteration 2 (needs a scheduler) — nothing puts a request there
 * yet, so this path exists for when it does, without depending on that work. ASSET_RETURNED audit
 * event in the same transaction. Gated by `requests:handoff` at the route (OD-4).
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {string} requestId
 * @param {{ condition?: string, note?: string, requestId?: string }} [input] validated `returnBody`,
 *   plus the HTTP request id for audit correlation
 * @returns {Promise<object>} the returned request
 * @throws {NotFoundError} (404) no such request in this organisation
 * @throws {StateTransitionError} (409) the request isn't CHECKED_OUT/OVERDUE (including a lost race)
 */
export async function returnUnit(orgId, actor, requestId, input = {}) {
  const request = await checkoutRequestRepo.findById(orgId, requestId);
  if (!request) {
    throw new NotFoundError('Request not found');
  }

  const { unitStatus } = assertTransition(request.state, S.RETURNED);

  return withTransaction(async (session) => {
    const updated = await checkoutRequestRepo.transition(
      orgId,
      requestId,
      {
        expectedState: request.state,
        patch: { state: S.RETURNED, returnedAt: new Date() },
      },
      { session },
    );
    if (!updated) {
      throw new StateTransitionError(request.state, S.RETURNED);
    }

    await assetUnitRepo.updateStatusAndCondition(
      orgId,
      updated.unitId,
      { status: unitStatus, condition: input.condition },
      { session },
    );

    await auditService.record(
      orgId,
      {
        actor,
        action: AUDIT_ACTION.ASSET_RETURNED,
        targetType: AUDIT_TARGET_TYPE.AssetUnit,
        targetId: updated.unitId,
        before: { status: U.OUT },
        after: { status: unitStatus, ...(input.condition ? { condition: input.condition } : {}) },
        requestId: input.requestId,
      },
      { session },
    );

    return updated;
  });
}
