// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: checkout request handlers (Sprint 1 stubs → 501); SCRUM-205 initiateReturn, rejectReturn, expireApprovals
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * HTTP layer for `/api/requests`: the checkout workflow.
 *
 * One handler per transition — approve, deny, cancel, checkout, return — mirroring the route design.
 * Each passes `req.orgId` and `req.auth` (who is acting, for the state machine's own rules and for the
 * audit trail) plus `req.id` so the audit event can be traced to this request.
 *
 * The decisions themselves belong to checkout.service.js; nothing here knows which transitions are
 * legal. The service functions are Sprint 1 stubs, so these routes currently answer 501 with their
 * ticket id.
 */
import * as checkoutService from '../services/checkout.service.js';

/**
 * `GET /api/requests` — list requests. The service narrows the result by role: a member sees only
 * their own.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function list(req, res) {
  res.status(200).json(await checkoutService.list(req.orgId, req.auth, req.query));
}

/**
 * `GET /api/requests/:id` — read one request.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function get(req, res) {
  res.status(200).json(await checkoutService.get(req.orgId, req.auth, req.params.id));
}

/**
 * `POST /api/requests` — open a checkout request. Answers 201.
 *
 * The requester is taken from `req.auth`, not the body, so nobody can file a request in someone
 * else's name.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function create(req, res) {
  res
    .status(201)
    .json(await checkoutService.submit(req.orgId, req.auth, { ...req.body, requestId: req.id }));
}

/**
 * `POST /api/requests/:id/approve` — approve a pending request and hold its unit.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function approve(req, res) {
  res.status(200).json(
    await checkoutService.approve(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

/**
 * `POST /api/requests/:id/deny` — refuse a pending request.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function deny(req, res) {
  res.status(200).json(
    await checkoutService.deny(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

/**
 * `POST /api/requests/:id/cancel` — withdraw one's own request, releasing any held unit.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function cancel(req, res) {
  res
    .status(200)
    .json(await checkoutService.cancel(req.orgId, req.auth, req.params.id, { requestId: req.id }));
}

/**
 * `POST /api/requests/:id/checkout` — record the handover of the item, by the borrower or a handoff
 * holder (SCRUM-205).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function checkout(req, res) {
  res
    .status(200)
    .json(
      await checkoutService.checkout(req.orgId, req.auth, req.params.id, { requestId: req.id }),
    );
}

/**
 * `POST /api/requests/:id/return` — record the item coming back, with any condition change.
 *
 * Named `returnUnit` rather than `return`, which is a reserved word.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function returnUnit(req, res) {
  res.status(200).json(
    await checkoutService.returnUnit(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

/**
 * `POST /api/requests/:id/initiate-return` — the borrower starts a return and reports the condition
 * (SCRUM-205). The unit stays out until someone else confirms it.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function initiateReturn(req, res) {
  res.status(200).json(
    await checkoutService.initiateReturn(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

/**
 * `POST /api/requests/:id/reject-return` — refuse a pending return that never arrived, with a reason
 * (SCRUM-205).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function rejectReturn(req, res) {
  res.status(200).json(
    await checkoutService.rejectReturn(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

/**
 * `POST /api/requests/mark-overdue` — flag the caller's organisation's late checkouts now.
 *
 * "Now" is the server's clock at the moment of the request, never a value from the client: letting
 * the caller back-date it would let an admin keep late items off the list. Stands in for a scheduler
 * until there is one.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function markOverdue(req, res) {
  const updated = await checkoutService.markOverdue(req.orgId, { now: new Date() });
  res.status(200).json({ updated });
}

/**
 * `POST /api/requests/expire-approvals` — expire the caller's organisation's uncollected approvals now
 * (SCRUM-205).
 *
 * The server's clock, never the client's, for the same reason as `markOverdue`: a caller who could
 * choose "now" could expire approvals early or keep stale ones alive. Stands in for a scheduler.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function expireApprovals(req, res) {
  const expired = await checkoutService.expireApprovals(req.orgId, {
    now: new Date(),
    requestId: req.id,
  });
  res.status(200).json({ expired });
}
