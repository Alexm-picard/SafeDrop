// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: user-management handlers (list, invite, resend invitation, change role)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; wired to the member-lifecycle service. Must be reviewed and tested by the owning team member before merge.

/**
 * HTTP layer for `/api/users`: membership and roles.
 *
 * Delegates to organization.service.js, since users exist only within an organisation. Every route
 * here requires `users:manage`, and the tenant comes from `req.orgId` — an admin can only ever manage
 * their own organisation's members, whatever the request says.
 *
 * The request id is passed to the mutations so the audit event they append can be correlated with the
 * log lines for the request.
 */
import * as organizationService from '../services/organization.service.js';

/**
 * `GET /api/users` — list the organisation's members, paginated.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function list(req, res) {
  const result = await organizationService.listUsers(req.orgId, req.query);
  res.status(200).json(result);
}

/**
 * `POST /api/users/invite` — invite someone into the caller's organisation. Answers 201.
 *
 * The response says how the email went (`delivery`) but never contains the link or its token: that
 * would let the admin choose the member's password.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function invite(req, res) {
  const result = await organizationService.inviteUser(req.orgId, req.auth, req.body, {
    requestId: req.id,
  });
  res.status(201).json(result);
}

/**
 * `PATCH /api/users/:id/role` — change a member's role.
 *
 * Only the role is forwarded from the body; the target user comes from the path and the tenant from
 * the token, so this cannot be turned into a way to edit anything else about a user.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function changeRole(req, res) {
  const result = await organizationService.changeUserRole(
    req.orgId,
    req.auth,
    req.params.id,
    req.body.role,
    { requestId: req.id },
  );
  res.status(200).json(result);
}

/**
 * `POST /api/users/:id/resend-invite` — send a member a fresh invitation link. Answers 200.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function resendInvite(req, res) {
  const result = await organizationService.resendInvite(req.orgId, req.auth, req.params.id, {
    requestId: req.id,
  });
  res.status(200).json(result);
}
