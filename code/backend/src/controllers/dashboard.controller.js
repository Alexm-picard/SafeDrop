// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: dashboard summary handler (SCRUM-103)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import * as dashboardService from '../services/dashboard.service.js';

export async function summary(req, res) {
  const result = await dashboardService.summary(req.orgId);
  res.status(200).json(result);
}
