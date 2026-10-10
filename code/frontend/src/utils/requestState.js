// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: frontend mirror of the checkout state machine and the actions each role may take; SCRUM-205 RETURN_PENDING/EXPIRED, borrower pickup and return, confirm/reject return
// Human Contributions: reviewed and merged by Mateus Silva (PR #32, 2026-09-20); latest changes reviewed and approved by Alex Picard (PR #61, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Written for SCRUM-123. Mirrors the backend's checkout.service.js TRANSITIONS — change both together. Reviewed before merge; see Human Contributions.

/**
 * The checkout state machine, as the SPA understands it (SDD §2.4, arch review F4).
 *
 * A copy of the backend's table in `services/checkout.service.js`. Duplication is deliberate: the
 * browser has to decide which buttons to draw before it asks the API anything, and the alternative —
 * an endpoint that lists legal transitions — is a round trip for information that changes about
 * once a semester. **The two tables must be changed together**; the tests below the fold in
 * `requestState.test.js` pin the shape, and the API refuses anything illegal regardless (SR-1).
 *
 * This decides what is *offered*. It never decides what is *allowed* — a member who edits their way
 * to a button still meets a 403 or a 409 from the API.
 *
 * Exports: `TRANSITIONS`, `canTransition`, `ACTIONS`, `actionsFor`.
 */
import { ROLES } from './constants';

/**
 * Which states each state may move to. Terminal states map to an empty object.
 */
export const TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['APPROVED', 'DENIED', 'CANCELLED']),
  APPROVED: Object.freeze(['CANCELLED', 'CHECKED_OUT', 'EXPIRED']),
  CHECKED_OUT: Object.freeze(['RETURN_PENDING', 'RETURNED', 'OVERDUE', 'LOST']),
  OVERDUE: Object.freeze(['RETURN_PENDING', 'RETURNED', 'LOST']),
  // SCRUM-205: the borrower says it is back; someone else confirms (RETURNED) or rejects it.
  RETURN_PENDING: Object.freeze(['RETURNED', 'CHECKED_OUT']),
  DENIED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  RETURNED: Object.freeze([]),
  LOST: Object.freeze([]),
  EXPIRED: Object.freeze([]),
});

/**
 * May a request move from `from` to `to`?
 *
 * `Object.hasOwn` rather than a property read, so a state named `constructor` or `__proto__` — from
 * a corrupt response or a mischievous URL — answers false instead of finding something on the
 * prototype chain. The backend guards the same way.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  if (!Object.hasOwn(TRANSITIONS, from)) {
    return false;
  }
  return TRANSITIONS[from].includes(to);
}

/**
 * The actions the detail screen can offer, and what each one needs.
 *
 * `to` is the state the action moves the request into, which is what makes `canTransition` the
 * arbiter of whether it is offered at all — rather than a list of hard-coded `state === 'PENDING'`
 * conditions that drift from the state machine. `allowed` adds the human question the state machine
 * cannot answer: who is entitled to press it. `from`, where present, narrows the source states for
 * the two actions that share a target: recording a pickup and rejecting a return both lead to
 * CHECKED_OUT, from different places.
 *
 * `label` may be a function of the viewer, because the same action reads differently to each side of
 * a handoff: the borrower says "I've picked it up", the desk "Record handoff".
 *
 * The permissions mirror the backend's matrix: `requests:decide` and `requests:handoff` belong to
 * APPROVER and ORG_ADMIN; cancelling is the requester's own business. Custody confirmation
 * (SCRUM-205): the borrower may record their own pickup and start their own return, and confirming
 * or rejecting a return follows `canConfirmReturn`, which the API computes for this viewer.
 */
export const ACTIONS = Object.freeze([
  Object.freeze({
    key: 'approve',
    label: 'Approve',
    to: 'APPROVED',
    allowed: ({ role }) => role === ROLES.APPROVER || role === ROLES.ORG_ADMIN,
  }),
  Object.freeze({
    key: 'deny',
    label: 'Deny',
    to: 'DENIED',
    allowed: ({ role }) => role === ROLES.APPROVER || role === ROLES.ORG_ADMIN,
  }),
  Object.freeze({
    key: 'cancel',
    label: 'Cancel request',
    to: 'CANCELLED',
    // The requester's own, whatever their role: an approver cancels their own request here, and
    // somebody else's through deny.
    allowed: ({ isRequester }) => isRequester,
  }),
  Object.freeze({
    key: 'checkout',
    label: ({ isRequester }) => (isRequester ? 'I’ve picked it up' : 'Record handoff'),
    to: 'CHECKED_OUT',
    from: Object.freeze(['APPROVED']),
    allowed: ({ role, isRequester }) => isRequester || isHandoffRole(role),
  }),
  Object.freeze({
    key: 'initiateReturn',
    label: 'Return this item',
    to: 'RETURN_PENDING',
    // The borrower's own, whatever their role (SCRUM-205 AT-4).
    allowed: ({ isRequester }) => isRequester,
  }),
  Object.freeze({
    key: 'return',
    label: ({ state }) => (state === 'RETURN_PENDING' ? 'Confirm return' : 'Record return'),
    to: 'RETURNED',
    allowed: ({ canConfirmReturn }) => canConfirmReturn,
  }),
  Object.freeze({
    key: 'rejectReturn',
    label: 'Reject return',
    to: 'CHECKED_OUT',
    from: Object.freeze(['RETURN_PENDING']),
    allowed: ({ canConfirmReturn }) => canConfirmReturn,
  }),
]);

/**
 * Does this role hold `requests:handoff`?
 * @param {string|undefined} role
 * @returns {boolean}
 */
function isHandoffRole(role) {
  return role === ROLES.APPROVER || role === ROLES.ORG_ADMIN;
}

/**
 * The actions to draw for this request, this viewer, right now.
 *
 * Both tests must pass: the state machine must permit the move, and the viewer must be entitled to
 * make it. A terminal state therefore produces nothing at all, without a special case.
 *
 * `viewer.canConfirmReturn` is the API's answer for this viewer (SCRUM-205): only the server can tell
 * whether a requester is the organisation's sole confirmer. Without it (an older response), the safe
 * reading is used: a handoff role confirms anyone's return but their own.
 * @param {{ state: string, requesterId: string }} request
 * @param {{ role: string, userId: string|null, canConfirmReturn?: boolean }} viewer
 * @returns {Array<{ key: string, label: string, to: string }>}
 */
export function actionsFor(request, viewer) {
  if (!request?.state) {
    return [];
  }
  const isRequester = Boolean(viewer?.userId) && viewer.userId === String(request.requesterId);
  const context = {
    role: viewer?.role,
    state: request.state,
    isRequester,
    canConfirmReturn:
      typeof viewer?.canConfirmReturn === 'boolean'
        ? viewer.canConfirmReturn
        : isHandoffRole(viewer?.role) && !isRequester,
  };
  return ACTIONS.filter(
    (action) =>
      canTransition(request.state, action.to) &&
      (!action.from || action.from.includes(request.state)) &&
      action.allowed(context),
  ).map(({ key, label, to }) => ({
    key,
    label: typeof label === 'function' ? label(context) : label,
    to,
  }));
}
