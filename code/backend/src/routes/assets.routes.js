// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/assets routes with permissions and schemas — controllers are Sprint 1 stubs
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Routes for `/api/assets`: the catalogue and its physical units.
 *
 * The permissions split reading from writing. Every role holds `assets:read`, so any member can browse
 * what is available; `assets:write` is ORG_ADMIN-only and covers creating, editing, retiring and
 * adding units. Retiring is a POST to `/:id/retire` rather than a DELETE because it is a soft delete —
 * the asset stays, with a retirement date, so historical requests still resolve.
 *
 * `GET /:id/history` is the exception to that split: it reads, but behind `audit:read` rather than
 * `assets:read`. What it returns is the audit trail, filtered to one asset, so it is governed by who
 * may read the trail — not by who may see the asset in the catalogue (SCRUM-29).
 *
 * Exports: `assetsRouter`, and the `assetBody` / `assetPatch` / `listQuery` / `unitBody` schemas for
 * reuse in tests.
 */
import { z } from 'zod';
import * as assets from '../controllers/assets.controller.js';
import { ASSET_CONDITION_LIST } from '../utils/constants.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { emptyBody, idParams, pagination } from './schemas.js';

/**
 * What each asset field may contain, with no defaults attached.
 *
 * The single definition the create and update schemas are both built from, so the two can never
 * disagree about what a field may hold — adding a field here makes it both creatable and updatable
 * under the same rules.
 *
 * `imageUrl` is parsed as a URL rather than a string, so a `javascript:` or `data:` value cannot be
 * stored and later rendered by the frontend as an image source.
 */
const assetFields = {
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000),
  imageUrl: z.url().max(2048).nullable(),
};

/**
 * Body for creating an asset: name, category, and optional description and image URL.
 *
 * The two optional fields carry defaults, so an asset created without them is stored with an empty
 * description and no image rather than with those keys missing.
 */
export const assetBody = z.object({
  ...assetFields,
  description: assetFields.description.default(''),
  imageUrl: assetFields.imageUrl.default(null),
});

/**
 * Body for updating an asset: every field of `assetBody`, all optional — and **no defaults**.
 *
 * This is built from `assetFields` rather than as `assetBody.partial()`, which is the obvious
 * spelling and is wrong. `.partial()` makes each key optional but leaves the `.default()` wrappers
 * in place, so `{ name: 'X' }` parses to `{ name: 'X', description: '', imageUrl: null }` — and a
 * PATCH meant to rename an asset would silently wipe its description and image. A patch schema must
 * distinguish "not mentioned" from "set to the default"; defaults belong only where a record is
 * being created.
 */
export const assetPatch = z.object(assetFields).partial();

/**
 * Query for listing assets: pagination, an optional category filter, and `includeRetired`.
 *
 * `includeRetired` arrives as the string `"true"`/`"false"` because query strings have no booleans;
 * it is parsed to a real boolean so the repository gets the type it expects. It defaults to `"false"`,
 * so the catalogue shows only what can actually be borrowed unless asked otherwise.
 */
export const listQuery = pagination.extend({
  category: z.string().trim().min(1).max(60).optional(),
  includeRetired: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

/**
 * Body for adding a physical unit to an asset: its tag, optional serial number and condition.
 *
 * The tag is the identifier on the item's sticker and is unique per organisation. Condition defaults
 * to GOOD; status is not accepted from the client, since a new unit's lifecycle always starts at
 * AVAILABLE.
 */
export const unitBody = z.object({
  tag: z.string().trim().min(1).max(64),
  serial: z.string().trim().max(128).nullable().default(null),
  condition: z.enum(ASSET_CONDITION_LIST).default('GOOD'),
});

export const assetsRouter = createRouter();

defineRoute(
  assetsRouter,
  { method: 'GET', path: '/', permission: PERMISSIONS.ASSETS_READ, schemas: { query: listQuery } },
  assets.list,
);
defineRoute(
  assetsRouter,
  { method: 'POST', path: '/', permission: PERMISSIONS.ASSETS_WRITE, schemas: { body: assetBody } },
  assets.create,
);
defineRoute(
  assetsRouter,
  {
    method: 'GET',
    path: '/:id',
    permission: PERMISSIONS.ASSETS_READ,
    schemas: { params: idParams },
  },
  assets.get,
);
defineRoute(
  assetsRouter,
  {
    method: 'PATCH',
    path: '/:id',
    permission: PERMISSIONS.ASSETS_WRITE,
    schemas: { params: idParams, body: assetPatch },
  },
  assets.update,
);
defineRoute(
  assetsRouter,
  {
    method: 'POST',
    path: '/:id/retire',
    permission: PERMISSIONS.ASSETS_WRITE,
    schemas: { params: idParams, body: emptyBody.optional() },
  },
  assets.retire,
);
defineRoute(
  assetsRouter,
  {
    method: 'GET',
    path: '/:id/history',
    // `audit:read`, not `assets:read`: this is the audit trail reached by a different question, and a
    // member who may browse the catalogue may not read who has held what (SCRUM-29 AT-3, SR-2).
    permission: PERMISSIONS.AUDIT_READ,
    schemas: { params: idParams, query: pagination },
  },
  assets.history,
);
defineRoute(
  assetsRouter,
  {
    method: 'POST',
    path: '/:id/units',
    permission: PERMISSIONS.ASSETS_WRITE,
    schemas: { params: idParams, body: unitBody },
  },
  assets.addUnit,
);
