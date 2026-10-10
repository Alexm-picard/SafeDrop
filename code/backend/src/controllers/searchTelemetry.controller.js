// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-206 story)
// AI-Assisted Areas: thin handler for GET /api/search-telemetry (SCRUM-206 AT-4)
// Human Contributions: pending review
// Notes: Written for SCRUM-206. Must be reviewed and tested by the owning team member before merge.

/**
 * HTTP layer for `/api/search-telemetry`.
 */
import * as searchTelemetryService from '../services/ai/searchTelemetry.service.js';

/**
 * `GET /api/search-telemetry` — how AI search is behaving in the caller's organisation (SCRUM-206).
 *
 * Thin by design: `req.orgId` comes from `scopeTenant` (the verified token, never the request) and
 * `req.query` has already been through the route's Zod schema.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function summary(req, res) {
  res.status(200).json(await searchTelemetryService.summarize(req.orgId, req.query));
}
