// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/users routes (users:manage) — controllers are Sprint 1 stubs
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { z } from 'zod';
import * as users from '../controllers/users.controller.js';
import { PERMISSIONS, ROLE_LIST } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { email, idParams, pagination, personName } from './schemas.js';

export const inviteBody = z.object({
  email,
  name: personName,
  role: z.enum(ROLE_LIST).default('MEMBER'),
});

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
