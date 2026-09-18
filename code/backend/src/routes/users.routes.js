// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/users routes (users:manage) — controllers are Sprint 1 stubs
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
import { email, idParams, pagination, personName } from './schemas.js';

/**
 * Body for `POST /api/users/invite`: the new member's email, name and role.
 *
 * The role defaults to MEMBER, so an invitation that says nothing about privileges grants the least
 * of them. There is no password field: the invitee sets their own.
 */
export const inviteBody = z.object({
  email,
  name: personName,
  role: z.enum(ROLE_LIST).default('MEMBER'),
});

/**
 * Body for `PATCH /api/users/:id/role`: the new role, which must be one of the three known ones.
 */
export const roleBody = z.object({ role: z.enum(ROLE_LIST) });

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
