// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/users routes (users:manage)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Routes for `/api/users`: membership and role administration.
 *
 * Every route requires `users:manage`, which only ORG_ADMIN holds — this is the router that can change
 * who is allowed to do what, so it is the narrowest gate in the API.
 *
 * Note the URL shapes: `PATCH /:id/role` takes the *user* id in the path, never an organisation id.
 * Which tenant the id is looked up in comes from the caller's token (SR-2).
 *
 * Exports: `usersRouter`, and the `inviteBody` / `roleBody` schemas for reuse in tests.
 */
import { z } from 'zod';
import * as users from '../controllers/users.controller.js';
import { PERMISSIONS, ROLE_LIST } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { email, idParams, pagination, password, personName } from './schemas.js';

/**
 * Body for `POST /api/users/invite`: the new member's email, name, role and initial password.
 *
 * The role defaults to MEMBER, so an invitation that says nothing about privileges grants the least of
 * them. Iteration 1 has no email service, so the admin sets the member's initial `password` and shares
 * it out of band; it goes through the shared `password` schema, so the strength and 72-byte rules apply.
 * There is no organisation field, so an invitation can only ever land in the caller's own organisation.
 */
export const inviteBody = z.object({
  email,
  name: personName,
  password,
  role: z.enum(ROLE_LIST).default('MEMBER'),
});

/**
 * Body for `PATCH /api/users/:id/role`: the new role, which must be one of the three known ones.
 */
export const roleBody = z.object({ role: z.enum(ROLE_LIST) });

/**
 * Body for `POST /api/users/:id/password`: the password an admin is setting for a member.
 *
 * Same strength rules as at invitation — this is a creation path, not a comparison — and the
 * account is flagged so the member must replace it at their next sign-in (SCRUM-22, SCRUM-36).
 */
export const setPasswordBody = z.object({ password });

export const usersRouter = createRouter();

defineRoute(
  usersRouter,
  {
    method: 'GET',
    path: '/',
    permission: PERMISSIONS.USERS_MANAGE,
    schemas: { query: pagination },
  },
  users.list,
);
defineRoute(
  usersRouter,
  {
    method: 'POST',
    path: '/invite',
    permission: PERMISSIONS.USERS_MANAGE,
    schemas: { body: inviteBody },
  },
  users.invite,
);
defineRoute(
  usersRouter,
  {
    method: 'PATCH',
    path: '/:id/role',
    permission: PERMISSIONS.USERS_MANAGE,
    schemas: { params: idParams, body: roleBody },
  },
  users.changeRole,
);
defineRoute(
  usersRouter,
  {
    method: 'POST',
    path: '/:id/password',
    permission: PERMISSIONS.USERS_MANAGE,
    schemas: { params: idParams, body: setPasswordBody },
  },
  users.setPassword,
);
