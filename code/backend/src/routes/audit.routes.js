// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: GET /api/audit (audit:read, paginated) — controller is a Sprint 1 stub; deliberately no PATCH/DELETE (SR-8)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { z } from 'zod';
import * as audit from '../controllers/audit.controller.js';
import { AUDIT_ACTION_LIST, AUDIT_TARGET_TYPE_LIST } from '../utils/constants.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { objectId, pagination } from './schemas.js';

export const auditQuery = pagination.extend({
  action: z.enum(AUDIT_ACTION_LIST).optional(),
  targetType: z.enum(AUDIT_TARGET_TYPE_LIST).optional(),
  targetId: objectId.optional(),
  actorId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const auditRouter = createRouter();

defineRoute(
  auditRouter,
  { method: 'GET', path: '/', permission: PERMISSIONS.AUDIT_READ, schemas: { query: auditQuery } },
  audit.list,
);
