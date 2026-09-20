// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: dashboard summary handler (SCRUM-103)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * HTTP layer for `/api/dashboard`.
 *
 * One handler returning the organisation's summary counts.
 */
import * as dashboardService from '../services/dashboard.service.js';

/**
 * `GET /api/dashboard/summary` — inventory, workflow and 30-day activity figures for the caller's
 * organisation (SCRUM-102).
 *
 * Takes nothing but the tenant: the route declares no schemas, so any query parameter a client adds
 * is rejected as a 400 before reaching here.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function summary(req, res) {
  const result = await dashboardService.summary(req.orgId);
  res.status(200).json(result);
}
