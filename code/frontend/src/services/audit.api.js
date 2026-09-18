// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed call for GET /api/audit (Sprint 1: the API answers 501 until SCRUM-audit-log)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Audit trail endpoint (ORG_ADMIN only).
 *
 * Read-only by design: there is no call to write, edit or delete an audit event, because the API
 * exposes none (SR-8).
 */
import { apiRequest } from './api';
/**
 * Read the organisation's audit trail, newest first.
 *
 * Filters are optional and `undefined` ones are left out of the query string entirely, so an unset
 * filter is absent rather than sent as the string `"undefined"`.
 * @param {{ page?: number, limit?: number, action?: string, targetType?: string, targetId?: string, actorId?: string, from?: string|Date, to?: string|Date }} [params]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export const list = (params = {}, signal) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return apiRequest(`/api/audit${qs ? `?${qs}` : ''}`, { signal });
};
