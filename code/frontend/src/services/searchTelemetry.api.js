// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: typed call for GET /api/search-telemetry (SCRUM-206 AT-4), for the dashboard's AI search card
// Human Contributions: feature choice and scope by Amber Rastella; reviewer recorded on the PR
// Notes: The endpoint returns aggregates only (no rows, no query text), which is all this module can ask for.

/**
 * Search telemetry summary endpoint (ORG_ADMIN only, `audit:read`).
 */
import { apiRequest } from './api';

/**
 * Read the organisation's AI search summary for the last 30 days (the server's default window).
 *
 * Covers both kinds of lookup the AI pipeline serves: typed searches and the "similar items" section.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ from: string, to: string, kind: string|null, total: number, aiAssisted: number,
 *   fallbacks: { disabled: number, unavailable: number, contract: number }, fallbackRate: number|null,
 *   zeroResults: number, zeroResultRate: number|null, candidateCapHits: number, candidateCap: number,
 *   latencyMs: { avg: number|null, p50: number|null, p95: number|null, max: number|null } }>}
 */
export const summary = (signal) => apiRequest('/api/search-telemetry', { signal });
