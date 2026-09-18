// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: audit log read handler (Sprint 1 stub → 501)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * HTTP layer for `/api/audit`.
 *
 * One handler, for reading the trail. There is no write handler anywhere: audit events are appended
 * by services as part of the transactions they describe, never by an HTTP call (SR-8).
 */
import * as auditService from '../services/audit.service.js';

/**
 * `GET /api/audit` — read the organisation's audit trail, newest first (SCRUM-46).
 *
 * Thin by design: `req.orgId` comes from `scopeTenant` (the verified token, never the request) and
 * `req.query` has already been through the route's Zod schema, so there is nothing left for the
 * controller to decide.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function list(req, res) {
  res.status(200).json(await auditService.list(req.orgId, req.query));
}
