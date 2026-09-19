// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: GET /api/audit (audit:read, paginated) — controller is a Sprint 1 stub; deliberately no PATCH/DELETE (SR-8)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Routes for `/api/audit`: reading the audit trail.
 *
 * One route, `GET /`, behind `audit:read` (ORG_ADMIN only). There is deliberately no route to write,
 * edit or delete an audit event: entries are appended by services as a side effect of the actions they
 * record, inside the same transaction, and the model refuses every mutating operation (SR-8).
 *
 * Exports: `auditRouter`, and `auditQuery` for reuse in tests.
 */
import { z } from 'zod';
import * as audit from '../controllers/audit.controller.js';
import { AUDIT_ACTION_LIST, AUDIT_TARGET_TYPE_LIST } from '../utils/constants.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { objectId, pagination } from './schemas.js';

/**
 * Query for `GET /api/audit`: pagination plus filters on action, target, actor and date range.
 *
 * Every filter is optional and constrained to known values or id/date formats, so the audit log can
 * be narrowed to one request's history or one person's actions without the filter itself becoming a
 * way to probe the collection.
 */
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
