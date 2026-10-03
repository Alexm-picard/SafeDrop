// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: POST /api/organizations (public bootstrap, SCRUM-100); GET/PATCH /me/approval-settings (SCRUM-148)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Routes for `/api/organizations`: tenant creation.
 *
 * One route, and it is the third and last public one. `POST /api/organizations` is the bootstrap:
 * somebody with no account creates an organisation and its first ORG_ADMIN in a single call, which is
 * the only way to get an initial administrator into a fresh tenant. Everything else about an
 * organisation is reached through the routes that live under its own resources.
 *
 * `GET` / `PATCH /api/organizations/me/approval-settings` (SCRUM-148) read and change the caller's own
 * organisation's approval default, both behind `org:settings` (ORG_ADMIN). "me" rather than an id: the
 * tenant always comes from the session, never the URL.
 *
 * Exports: `organizationsRouter`, and `createOrganizationBody` / `approvalSettingsBody` for reuse in
 * tests.
 */
import { z } from 'zod';
import * as organizations from '../controllers/organizations.controller.js';
import { createRouter, defineRoute } from './define.js';
import { ORG_APPROVAL_MODE_LIST } from '../utils/constants.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { email, orgName, password, personName } from './schemas.js';

/**
 * Body for `POST /api/organizations`: the organisation's name plus the first admin's name, email and
 * password.
 *
 * The admin's credentials are created in the same request as the organisation, so a tenant never
 * exists in a state where anyone could claim its first account. The password goes through the shared
 * `password` schema, so the strength and byte-cap rules apply here — this is a creation path, unlike
 * login.
 */
export const createOrganizationBody = z.object({
  orgName,
  adminName: personName,
  adminEmail: email,
  adminPassword: password,
});

export const organizationsRouter = createRouter();

defineRoute(
  organizationsRouter,
  { method: 'POST', path: '/', public: true, schemas: { body: createOrganizationBody } },
  organizations.create,
);

/**
 * Body for `PATCH /api/organizations/me/approval-settings` (SCRUM-148).
 *
 * Only REQUIRED or AUTO: INHERIT is an asset-level value and means nothing on an organisation.
 */
export const approvalSettingsBody = z.object({
  defaultMode: z.enum(ORG_APPROVAL_MODE_LIST),
});

defineRoute(
  organizationsRouter,
  { method: 'GET', path: '/me/approval-settings', permission: PERMISSIONS.ORG_SETTINGS },
  organizations.getApprovalSettings,
);
defineRoute(
  organizationsRouter,
  {
    method: 'PATCH',
    path: '/me/approval-settings',
    permission: PERMISSIONS.ORG_SETTINGS,
    schemas: { body: approvalSettingsBody },
  },
  organizations.updateApprovalSettings,
);
