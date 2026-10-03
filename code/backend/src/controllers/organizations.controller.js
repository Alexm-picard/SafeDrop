// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: organisation bootstrap handler (SCRUM-100); approval settings handlers (SCRUM-148); pickup settings handlers (SCRUM-205)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * HTTP layer for `/api/organizations`.
 *
 * The public bootstrap route that creates a tenant and its first administrator, and the caller's own
 * organisation's approval settings (SCRUM-148).
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

/**
 * `GET /api/organizations/me/approval-settings` — the caller's organisation's approval default
 * (SCRUM-148). The organisation always comes from the session (`req.orgId`), never the URL.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function getApprovalSettings(req, res) {
  res.status(200).json(await organizationService.getApprovalSettings(req.orgId));
}

/**
 * `PATCH /api/organizations/me/approval-settings` — change the approval default (SCRUM-148).
 *
 * Answers 200 with the settings as saved. The request id is passed down so the ORG_SETTINGS_UPDATED
 * audit event can be correlated with this request's log lines.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function updateApprovalSettings(req, res) {
  const settings = await organizationService.updateApprovalSettings(req.orgId, req.auth, req.body, {
    requestId: req.id,
  });
  res.status(200).json(settings);
}

/**
 * `GET /api/organizations/me/pickup-settings` — the caller's organisation's pickup grace period
 * (SCRUM-205).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function getPickupSettings(req, res) {
  res.status(200).json(await organizationService.getPickupSettings(req.orgId));
}

/**
 * `PATCH /api/organizations/me/pickup-settings` — change the pickup grace period (SCRUM-205).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function updatePickupSettings(req, res) {
  const settings = await organizationService.updatePickupSettings(req.orgId, req.auth, req.body, {
    requestId: req.id,
  });
  res.status(200).json(settings);
}
