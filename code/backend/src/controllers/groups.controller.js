// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the user-groups ticket)
// AI-Assisted Areas: HTTP layer for /api/groups (SCRUM-149)
// Human Contributions: reviewed and approved by Alex Picard (PR #59, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Written from the ticket's acceptance criteria. Reviewed before merge; see Human Contributions.

/**
 * HTTP layer for `/api/groups`: named cohorts and their membership.
 *
 * Delegates to `group.service.js`, since groups exist only within an organisation. Every route here
 * requires `groups:manage`, and the tenant comes from `req.orgId` — an admin can only ever manage their
 * own organisation's groups, whatever a request says. The request id is passed to every mutation so
 * the audit event it appends can be correlated with the log lines for that request.
 */
import * as groupService from '../services/group.service.js';

/**
 * `GET /api/groups` — list the organisation's groups, paginated.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function list(req, res) {
  const result = await groupService.listGroups(req.orgId, req.query);
  res.status(200).json(result);
}

/**
 * `POST /api/groups` — create a group. Answers 201.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function create(req, res) {
  const result = await groupService.createGroup(req.orgId, req.auth, req.body, {
    requestId: req.id,
  });
  res.status(201).json(result);
}

/**
 * `GET /api/groups/:id` — one group, with its members resolved.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function get(req, res) {
  const result = await groupService.getGroup(req.orgId, req.params.id);
  res.status(200).json(result);
}

/**
 * `PATCH /api/groups/:id` — rename and/or redescribe a group.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function update(req, res) {
  const result = await groupService.updateGroup(req.orgId, req.auth, req.params.id, req.body, {
    requestId: req.id,
  });
  res.status(200).json(result);
}

/**
 * `DELETE /api/groups/:id` — delete a group. Answers 204.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function remove(req, res) {
  await groupService.deleteGroup(req.orgId, req.auth, req.params.id, { requestId: req.id });
  res.status(204).end();
}

/**
 * `POST /api/groups/:id/members` — add one member. Answers 200 whether this call was the one that
 * added them or they were already a member (idempotent; see `addGroupMember`'s docs).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function addMember(req, res) {
  const result = await groupService.addGroupMember(
    req.orgId,
    req.auth,
    req.params.id,
    req.body.userId,
    { requestId: req.id },
  );
  res.status(200).json(result);
}

/**
 * `DELETE /api/groups/:id/members/:userId` — remove one member. Answers 200 with the updated group,
 * whether or not they were a member beforehand.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function removeMember(req, res) {
  const result = await groupService.removeGroupMember(
    req.orgId,
    req.auth,
    req.params.id,
    req.params.userId,
    { requestId: req.id },
  );
  res.status(200).json(result);
}
