// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/requests routes with permissions and schemas — controllers are Sprint 1 stubs; SCRUM-205 borrower-recorded pickup, initiate-return, reject-return, expire-approvals, scope=others
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Routes for `/api/requests`: the borrowing workflow from request to return.
 *
 * The permissions map onto the three parts people play. A member creates and cancels their own
 * requests (`requests:create`) and reads them (`requests:read:own`); an approver decides them
 * (`requests:decide`); whoever hands the item over and takes it back records that
 * (`requests:handoff`). Approvers and admins hold the deciding and handoff permissions as well, since
 * the roles are cumulative.
 *
 * Each state change is its own POST — `/approve`, `/deny`, `/cancel`, `/checkout`, `/return` — rather
 * than a PATCH setting `state`. That way each transition has its own permission and its own audit
 * event, and a client cannot move a request to an arbitrary state by naming it.
 *
 * Custody confirmation (SCRUM-205) changes two gates. `/checkout` is open to every role
 * (`requests:create`) because the borrower may record their own pickup; the service refuses anyone who
 * is neither the borrower nor a handoff holder. `/initiate-return` is the borrower's, any role.
 * `/return` and `/reject-return` stay behind `requests:handoff`, and the service adds the rule that
 * the requester cannot confirm their own return.
 *
 * Exports: `requestsRouter`, and the `createRequestBody` / `decisionBody` / `returnBody` /
 * `initiateReturnBody` / `rejectReturnBody` / `listQuery` schemas for reuse in tests.
 */
import { z } from 'zod';
import * as requests from '../controllers/requests.controller.js';
import { ASSET_CONDITION_LIST, REQUEST_STATE_LIST } from '../utils/constants.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { emptyBody, idParams, objectId, pagination } from './schemas.js';

/**
 * Body for `POST /api/requests`: which unit, for what window, with an optional note.
 *
 * The `.refine()` enforces that the window is ordered — a request ending before it starts is
 * nonsense the service would otherwise have to handle. There is no requester field: who is asking
 * comes from the token, so one member cannot file a request in another's name.
 */
export const createRequestBody = z
  .object({
    unitId: objectId,
    neededFrom: z.coerce.date(),
    neededTo: z.coerce.date(),
    note: z.string().trim().max(1000).default(''),
  })
  .refine((v) => v.neededTo > v.neededFrom, {
    message: 'neededTo must be after neededFrom',
    path: ['neededTo'],
  });

/**
 * Body shared by `/approve` and `/deny`: just the decision note.
 *
 * The note defaults to empty and the body itself is optional on both routes, so approving without
 * comment is a POST with no body at all.
 */
export const decisionBody = z.object({ note: z.string().trim().max(1000).default('') });
/**
 * Body for `/return`: the condition the item came back in, plus an optional note.
 *
 * Condition is optional — when it is omitted the unit keeps the condition it had — so the person
 * taking an item back only has to record a change.
 */
export const returnBody = z.object({
  condition: z.enum(ASSET_CONDITION_LIST).optional(),
  note: z.string().trim().max(1000).default(''),
});
/**
 * Body for `/initiate-return` (SCRUM-205): the condition the borrower reports, and an optional note.
 *
 * Condition is required here, unlike on `/return`: reporting it is the point of starting a return,
 * and the confirmer compares it with what they receive.
 */
export const initiateReturnBody = z.object({
  condition: z.enum(ASSET_CONDITION_LIST),
  note: z.string().trim().max(1000).default(''),
});
/**
 * Body for `/reject-return` (SCRUM-205): why the return is refused. Required, because "it never
 * arrived" is the whole content of the audit entry.
 */
export const rejectReturnBody = z.object({
  reason: z.string().trim().min(1).max(1000),
});
/**
 * Query for listing requests: pagination, an optional state filter, and `scope`.
 *
 * `state=PENDING` is what the approval queue asks for. `scope` is how a caller who holds
 * `requests:decide` (APPROVER, ORG_ADMIN) chooses between their own requests and the whole
 * organisation's: omitted or `'own'` always means "my requests," for every role — that is what keeps
 * an admin's "My requests" page showing their own requests instead of everyone's. Only an explicit
 * `scope=org` asks for the organisation-wide view, and the service still ignores it for a caller who
 * cannot decide requests, the same way a smuggled `orgId` is ignored elsewhere rather than rejected.
 * The state filter is restricted to known states, so an unknown value is a 400 rather than a query
 * that silently matches nothing. `scope=others` (SCRUM-205) is the organisation-wide view without the
 * caller's own requests, which is what the "Pending returns" queue asks for.
 *
 * `overdue=true` asks for the loans past their due date and not yet back — the same definition the
 * dashboard's Overdue figure counts — whatever their stored state. It arrives as the string
 * `"true"`/`"false"` because query strings have no booleans.
 */
export const listQuery = pagination.extend({
  state: z.enum(REQUEST_STATE_LIST).optional(),
  scope: z.enum(['own', 'org', 'others']).optional(),
  overdue: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const requestsRouter = createRouter();

defineRoute(
  requestsRouter,
  {
    method: 'GET',
    path: '/',
    permission: PERMISSIONS.REQUESTS_READ_OWN,
    schemas: { query: listQuery },
  },
  requests.list,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/',
    permission: PERMISSIONS.REQUESTS_CREATE,
    schemas: { body: createRequestBody },
  },
  requests.create,
);
defineRoute(
  requestsRouter,
  {
    method: 'GET',
    path: '/:id',
    permission: PERMISSIONS.REQUESTS_READ_OWN,
    schemas: { params: idParams },
  },
  requests.get,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/approve',
    permission: PERMISSIONS.REQUESTS_DECIDE,
    schemas: { params: idParams, body: decisionBody.optional() },
  },
  requests.approve,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/deny',
    permission: PERMISSIONS.REQUESTS_DECIDE,
    schemas: { params: idParams, body: decisionBody.optional() },
  },
  requests.deny,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/cancel',
    permission: PERMISSIONS.REQUESTS_CREATE,
    schemas: { params: idParams, body: emptyBody.optional() },
  },
  requests.cancel,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/checkout',
    // SCRUM-205: every role, so the borrower can record their own pickup. checkout() refuses anyone
    // who is neither the requester nor a `requests:handoff` holder.
    permission: PERMISSIONS.REQUESTS_CREATE,
    schemas: { params: idParams, body: emptyBody.optional() },
  },
  requests.checkout,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/initiate-return',
    // The requester only, whatever their role; initiateReturn() answers 404 to anyone else.
    permission: PERMISSIONS.REQUESTS_CREATE,
    schemas: { params: idParams, body: initiateReturnBody },
  },
  requests.initiateReturn,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/return',
    permission: PERMISSIONS.REQUESTS_HANDOFF,
    schemas: { params: idParams, body: returnBody.optional() },
  },
  requests.returnUnit,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/reject-return',
    permission: PERMISSIONS.REQUESTS_HANDOFF,
    schemas: { params: idParams, body: rejectReturnBody },
  },
  requests.rejectReturn,
);

// Org Admin only, and no body: the instant is the server's, never the caller's (see the controller).
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/mark-overdue',
    permission: PERMISSIONS.REQUESTS_MARK_OVERDUE,
    schemas: { body: emptyBody.optional() },
  },
  requests.markOverdue,
);

// Org Admin only, no body, and the server's clock, exactly like mark-overdue (SCRUM-205).
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/expire-approvals',
    permission: PERMISSIONS.REQUESTS_EXPIRE,
    schemas: { body: emptyBody.optional() },
  },
  requests.expireApprovals,
);
