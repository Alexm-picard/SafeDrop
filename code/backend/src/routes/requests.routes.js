// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/requests routes with permissions and schemas — controllers are Sprint 1 stubs
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { z } from 'zod';
import * as requests from '../controllers/requests.controller.js';
import { REQUEST_STATE_LIST } from '../utils/constants.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { emptyBody, idParams, objectId, pagination } from './schemas.js';

export const createRequestBody = z
  .object({
    unitId: objectId,
    neededFrom: z.coerce.date(),
    neededTo: z.coerce.date(),
    note: z.string().trim().max(1000).default(''),
  })
  .refine((v) => v.neededTo > v.neededFrom, {
    message: 'neededTo must be after neededFrom',
    path: ['neededTo'],
  });

export const decisionBody = z.object({ note: z.string().trim().max(1000).default('') });
export const returnBody = z.object({
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR']).optional(),
  note: z.string().trim().max(1000).default(''),
});
export const listQuery = pagination.extend({ state: z.enum(REQUEST_STATE_LIST).optional() });

export const requestsRouter = createRouter();

defineRoute(
  requestsRouter,
  {
    method: 'GET',
    path: '/',
    permission: PERMISSIONS.REQUESTS_READ_OWN,
    schemas: { query: listQuery },
  },
  requests.list,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/',
    permission: PERMISSIONS.REQUESTS_CREATE,
    schemas: { body: createRequestBody },
  },
  requests.create,
);
defineRoute(
  requestsRouter,
  {
    method: 'GET',
    path: '/:id',
    permission: PERMISSIONS.REQUESTS_READ_OWN,
    schemas: { params: idParams },
  },
  requests.get,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/approve',
    permission: PERMISSIONS.REQUESTS_DECIDE,
    schemas: { params: idParams, body: decisionBody.optional() },
  },
  requests.approve,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/deny',
    permission: PERMISSIONS.REQUESTS_DECIDE,
    schemas: { params: idParams, body: decisionBody.optional() },
  },
  requests.deny,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/cancel',
    permission: PERMISSIONS.REQUESTS_CREATE,
    schemas: { params: idParams, body: emptyBody.optional() },
  },
  requests.cancel,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/checkout',
    permission: PERMISSIONS.REQUESTS_HANDOFF,
    schemas: { params: idParams, body: emptyBody.optional() },
  },
  requests.checkout,
);
defineRoute(
  requestsRouter,
  {
    method: 'POST',
    path: '/:id/return',
    permission: PERMISSIONS.REQUESTS_HANDOFF,
    schemas: { params: idParams, body: returnBody.optional() },
  },
  requests.returnUnit,
);
