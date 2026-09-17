// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/assets routes with permissions and schemas — controllers are Sprint 1 stubs
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { z } from 'zod';
import * as assets from '../controllers/assets.controller.js';
import { ASSET_CONDITION_LIST } from '../utils/constants.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { emptyBody, idParams, pagination } from './schemas.js';

export const assetBody = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000).default(''),
  imageUrl: z.url().max(2048).nullable().default(null),
});

export const assetPatch = assetBody.partial();

export const listQuery = pagination.extend({
  category: z.string().trim().min(1).max(60).optional(),
  includeRetired: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

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
    method: 'POST',
    path: '/:id/units',
    permission: PERMISSIONS.ASSETS_WRITE,
    schemas: { params: idParams, body: unitBody },
  },
  assets.addUnit,
);
