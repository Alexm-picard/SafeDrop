// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: organisation bootstrap handler (SCRUM-101)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import * as organizationService from '../services/organization.service.js';
import { setSessionCookies } from './auth.controller.js';

export async function create(req, res) {
  const { organization, user, ...tokens } = await organizationService.createOrganization({
    ...req.body,
    requestId: req.id,
  });
  setSessionCookies(res, tokens);
  res.status(201).json({ organization, user });
}
