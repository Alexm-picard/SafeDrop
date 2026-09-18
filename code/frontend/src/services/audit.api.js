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
