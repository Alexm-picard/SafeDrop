// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: audit log read handler (Sprint 1 stub → 501)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import * as auditService from '../services/audit.service.js';

export async function list(req, res) {
  res.status(200).json(await auditService.list(req.orgId, req.query));
}
