// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: GET /api/dashboard/summary (ORG_ADMIN, SCRUM-103)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import * as dashboard from '../controllers/dashboard.controller.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';

export const dashboardRouter = createRouter();

defineRoute(
  dashboardRouter,
  { method: 'GET', path: '/summary', permission: PERMISSIONS.DASHBOARD_READ },
  dashboard.summary,
);
