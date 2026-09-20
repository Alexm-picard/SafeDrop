// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: frontend mirror of the checkout state machine and the actions each role may take
// Human Contributions: pending team review
// Notes: Written for SCRUM-123. Mirrors the backend's checkout.service.js TRANSITIONS — change both together. Must be reviewed by the owning team member before merge.

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
  APPROVED: Object.freeze(['CANCELLED', 'CHECKED_OUT']),
  CHECKED_OUT: Object.freeze(['RETURNED', 'OVERDUE', 'LOST']),
  OVERDUE: Object.freeze(['RETURNED', 'LOST']),
  DENIED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  RETURNED: Object.freeze([]),
  LOST: Object.freeze([]),
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
 * cannot answer: who is entitled to press it.
 *
 * The permissions mirror the backend's matrix: `requests:decide` and `requests:handoff` belong to
 * APPROVER and ORG_ADMIN; cancelling is the requester's own business.
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
    label: 'Record handoff',
    to: 'CHECKED_OUT',
    allowed: ({ role }) => role === ROLES.APPROVER || role === ROLES.ORG_ADMIN,
  }),
  Object.freeze({
    key: 'return',
    label: 'Record return',
    to: 'RETURNED',
    allowed: ({ role }) => role === ROLES.APPROVER || role === ROLES.ORG_ADMIN,
  }),
]);

/**
 * The actions to draw for this request, this viewer, right now.
 *
 * Both tests must pass: the state machine must permit the move, and the viewer must be entitled to
 * make it. A terminal state therefore produces nothing at all, without a special case.
 * @param {{ state: string }} request
 * @param {{ role: string, userId: string|null }} viewer
 * @returns {Array<{ key: string, label: string, to: string }>}
 */
export function actionsFor(request, viewer) {
  if (!request?.state) {
    return [];
  }
  const context = {
    role: viewer?.role,
    isRequester: Boolean(viewer?.userId) && viewer.userId === String(request.requesterId),
  };
  return ACTIONS.filter(
    (action) => canTransition(request.state, action.to) && action.allowed(context),
  ).map(({ key, label, to }) => ({ key, label, to }));
}
