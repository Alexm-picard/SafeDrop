// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: GET /api/dashboard/summary (ORG_ADMIN, SCRUM-103)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Routes for `/api/dashboard`: the aggregate view.
 *
 * One route, `GET /summary`, behind `dashboard:read` (ORG_ADMIN only). It returns counts across the
 * whole organisation — units per status, pending requests, users — which is why it is admin-only even
 * though none of the individual numbers is sensitive on its own.
 *
 * It declares no schemas, which under the rules in middleware/validate.js means it accepts no query
 * parameters at all: anything a client appends is a 400.
 *
 * Exports: `dashboardRouter`.
 */
import * as dashboard from '../controllers/dashboard.controller.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';

export const dashboardRouter = createRouter();

defineRoute(
  dashboardRouter,
  { method: 'GET', path: '/summary', permission: PERMISSIONS.DASHBOARD_READ },
  dashboard.summary,
);
