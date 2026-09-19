// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed calls for /api/assets/* (list/get implemented by SCRUM-115; write endpoints remain 501 stubs)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Asset catalogue endpoints.
 *
 * A thin mapping from function names to `/api/assets` routes; all the transport behaviour lives in
 * services/api.js. Every id is passed through `encodeURIComponent`, so a value containing a slash or
 * a question mark cannot change which endpoint is called.
 */
import { apiRequest } from './api';
/**
 * Build a query string from a parameter object, skipping `undefined` values.
 *
 * Skipping them matters: an unset filter must be absent from the URL, not sent as the literal string
 * `"undefined"`, which the API would reject as an invalid value.
 * @param {Record<string, unknown>} params
 * @returns {string} `?a=1&b=2`, or `''` when there is nothing to send
 */
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
/**
 * List the catalogue, optionally filtered and paginated.
 * @param {{ page?: number, limit?: number, category?: string, includeRetired?: boolean }} [params]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export const list = (params = {}, signal) => apiRequest(`/api/assets${query(params)}`, { signal });
/**
 * Read one asset with its units.
 * @param {string} id
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>}
 */
export const get = (id, signal) => apiRequest(`/api/assets/${encodeURIComponent(id)}`, { signal });
/**
 * Create an asset (ORG_ADMIN).
 * @param {object} input name, category, description, imageUrl
 * @returns {Promise<object>}
 */
export const create = (input) => apiRequest('/api/assets', { method: 'POST', body: input });
/**
 * Update an asset (ORG_ADMIN). PATCH, so only the given fields change.
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object>}
 */
export const update = (id, patch) =>
  apiRequest(`/api/assets/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
/**
 * Retire an asset (ORG_ADMIN): a soft delete, hence a POST to `/retire` rather than a DELETE.
 * @param {string} id
 * @returns {Promise<object>}
 */
export const retire = (id) =>
  apiRequest(`/api/assets/${encodeURIComponent(id)}/retire`, { method: 'POST', body: {} });
/**
 * Add a physical unit to an asset (ORG_ADMIN).
 * @param {string} id asset id
 * @param {{ tag: string, serial?: string, condition?: string }} input
 * @returns {Promise<object>}
 */
export const addUnit = (id, input) =>
  apiRequest(`/api/assets/${encodeURIComponent(id)}/units`, {
    method: 'POST',
    body: input,
  });
