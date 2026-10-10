// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-206 story)
// AI-Assisted Areas: GET /api/search-telemetry behind audit:read, aggregates only (SCRUM-206 AT-4)
// Human Contributions: pending review
// Notes: Written for SCRUM-206. Must be reviewed and tested by the owning team member before merge.

/**
 * Routes for `/api/search-telemetry`: how AI search is behaving in the caller's organisation.
 *
 * One route, `GET /`, behind `audit:read` (ORG_ADMIN only), returning aggregates and never rows. There
 * is no route that lists individual searches, and none that takes an id: with no per-row read there
 * is nothing another tenant's id could address, and `orgId` comes only from the token (SR-2).
 *
 * Exports: `searchTelemetryRouter`, and `searchTelemetryQuery` for reuse in tests.
 */
import { z } from 'zod';
import * as searchTelemetry from '../controllers/searchTelemetry.controller.js';
import { SEARCH_KIND_LIST } from '../utils/constants.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';

/**
 * Query for `GET /api/search-telemetry`: an optional date range and an optional feature.
 *
 * Both ends of the range are optional; the service defaults to the last 30 days. A range that ends
 * before it starts is a 400 rather than an empty summary, which would look like "nobody searched".
 */
export const searchTelemetryQuery = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    kind: z.enum(SEARCH_KIND_LIST).optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export const searchTelemetryRouter = createRouter();

defineRoute(
  searchTelemetryRouter,
  {
    method: 'GET',
    path: '/',
    permission: PERMISSIONS.AUDIT_READ,
    schemas: { query: searchTelemetryQuery },
  },
  searchTelemetry.summary,
);
