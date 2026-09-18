// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: user-management handlers (Sprint 1 stubs → 501)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * HTTP layer for `/api/users`: membership and roles.
 *
 * Delegates to organization.service.js, since users exist only within an organisation. Every route
 * here requires `users:manage`, and the tenant comes from `req.orgId` — an admin can only ever manage
 * their own organisation's members, whatever the request says.
 *
 * The service functions are Sprint 1 stubs, so these routes currently answer 501 with their ticket id.
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
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function invite(req, res) {
  const result = await organizationService.inviteUser(req.orgId, req.auth, req.body);
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
  );
  res.status(200).json(result);
}
