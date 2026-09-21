// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: organisation bootstrap handler (SCRUM-100)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * HTTP layer for `/api/organizations`.
 *
 * One handler, for the public bootstrap route that creates a tenant and its first administrator.
 */
import * as organizationService from '../services/organization.service.js';
import { setSessionCookies } from './auth.controller.js';

/**
 * `POST /api/organizations` — create an organisation with its first ORG_ADMIN and sign them in.
 *
 * The request id is passed down so the ORG_CREATED audit event can be correlated with the log lines
 * for this request. Because the service also starts a session, the response sets the session cookies
 * and the SPA can go straight to the dashboard instead of bouncing through a login form.
 *
 * Answers 201 with the organisation and user; the tokens travel as cookies.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function create(req, res) {
  const { organization, user, ...tokens } = await organizationService.createOrganization({
    ...req.body,
    requestId: req.id,
  });
  setSessionCookies(res, tokens);
  res.status(201).json({ organization, user });
}
