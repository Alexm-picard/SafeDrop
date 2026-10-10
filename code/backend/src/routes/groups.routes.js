// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the user-groups ticket)
// AI-Assisted Areas: /api/groups routes with permissions and Zod schemas (SCRUM-149)
// Human Contributions: reviewed and approved by Alex Picard (PR #59, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Written from the ticket's acceptance criteria. Reviewed before merge; see Human Contributions.

/**
 * Routes for `/api/groups`: named cohorts of members and their membership.
 *
 * Every route — reads included — requires `groups:manage`, the same shape as `/api/users`'s `GET /`
 * (also `users:manage`-gated): the ticket's design notes define exactly one permission for this whole
 * resource, with no separate read grant, so there is nothing narrower to check reads against.
 *
 * Membership is addressed as its own sub-resource (`/:id/members`, `/:id/members/:userId`) rather than
 * through the group body, so adding or removing one person is one small, auditable call instead of a
 * PATCH that resends the whole member list and risks dropping someone the client's copy was missing.
 *
 * Exports: `groupsRouter`, and the `groupBody` / `groupPatch` / `memberParams` schemas for reuse in
 * tests.
 */
import { z } from 'zod';
import * as groups from '../controllers/groups.controller.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { emptyBody, idParams, objectId, pagination } from './schemas.js';

/**
 * What a group's own fields may contain, with no defaults attached — the single definition the create
 * and update bodies are both built from, the same split `assetFields` uses in `assets.routes.js`.
 */
const groupFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
};

/**
 * Body for creating a group: a name, and an optional description.
 *
 * There is no `memberIds` field here: a group is created empty and members are added one at a time
 * through `POST /:id/members` (AT-1's "creates the group and adds Dana and Lee" is two kinds of call,
 * not one), which keeps each admin action — and each audit event — about exactly one thing.
 */
export const groupBody = z.object({
  ...groupFields,
  description: groupFields.description.default(''),
});

/**
 * Body for renaming or redescribing a group: both fields optional, **no defaults** — built from
 * `groupFields` rather than `groupBody.partial()` for the same reason `assetPatch` is: `.partial()`
 * would leave the `.default('')` wrapper in place, and `{ name: 'X' }` would silently wipe the
 * description of a group that only meant to rename itself.
 */
export const groupPatch = z.object(groupFields).partial();

/**
 * Body for `POST /api/groups/:id/members`: the id of the member to add.
 */
export const memberBody = z.object({ userId: objectId });

/**
 * Params for a route addressing one member *through* the group they belong to — the same shape
 * `assets.routes.js`'s `unitParams` uses for a unit through its asset.
 */
export const memberParams = z.object({ id: objectId, userId: objectId });

export const groupsRouter = createRouter();

defineRoute(
  groupsRouter,
  {
    method: 'GET',
    path: '/',
    permission: PERMISSIONS.GROUPS_MANAGE,
    schemas: { query: pagination },
  },
  groups.list,
);
defineRoute(
  groupsRouter,
  {
    method: 'POST',
    path: '/',
    permission: PERMISSIONS.GROUPS_MANAGE,
    schemas: { body: groupBody },
  },
  groups.create,
);
defineRoute(
  groupsRouter,
  {
    method: 'GET',
    path: '/:id',
    permission: PERMISSIONS.GROUPS_MANAGE,
    schemas: { params: idParams },
  },
  groups.get,
);
defineRoute(
  groupsRouter,
  {
    method: 'PATCH',
    path: '/:id',
    permission: PERMISSIONS.GROUPS_MANAGE,
    schemas: { params: idParams, body: groupPatch },
  },
  groups.update,
);
defineRoute(
  groupsRouter,
  {
    method: 'DELETE',
    path: '/:id',
    permission: PERMISSIONS.GROUPS_MANAGE,
    schemas: { params: idParams, body: emptyBody.optional() },
  },
  groups.remove,
);
defineRoute(
  groupsRouter,
  {
    method: 'POST',
    path: '/:id/members',
    permission: PERMISSIONS.GROUPS_MANAGE,
    schemas: { params: idParams, body: memberBody },
  },
  groups.addMember,
);
defineRoute(
  groupsRouter,
  {
    method: 'DELETE',
    path: '/:id/members/:userId',
    permission: PERMISSIONS.GROUPS_MANAGE,
    schemas: { params: memberParams, body: emptyBody.optional() },
  },
  groups.removeMember,
);
