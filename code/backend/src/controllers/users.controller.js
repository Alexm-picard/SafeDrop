// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: user-management handlers (Sprint 1 stubs → 501)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import * as organizationService from '../services/organization.service.js';

export async function list(req, res) {
  const result = await organizationService.listUsers(req.orgId, req.query);
  res.status(200).json(result);
}

export async function invite(req, res) {
  const result = await organizationService.inviteUser(req.orgId, req.auth, req.body);
  res.status(201).json(result);
}

export async function changeRole(req, res) {
  const result = await organizationService.changeUserRole(
    req.orgId,
    req.auth,
    req.params.id,
    req.body.role,
  );
  res.status(200).json(result);
}
