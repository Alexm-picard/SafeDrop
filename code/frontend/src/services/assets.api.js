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
 * Search the catalogue in plain words (SCRUM-200). AI-ranked when the backend has AI on, otherwise
 * a plain match — the response says which, and the caller renders both the same way.
 * @param {string} q what the member typed, already trimmed and non-empty
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ matches: Array<{ assetId: string, name: string, category: string, description: string, reason?: string }>, clarification: string|null, aiAssisted: boolean }>}
 */
export const search = (q, signal) => apiRequest(`/api/assets/search${query({ q })}`, { signal });
/**
 * Comparable items available right now, for an asset the caller cannot borrow (SCRUM-151).
 *
 * Only worth calling when the asset has no available unit — the backend answers an empty list either
 * way, but the point of the feature is to cost nothing when nobody is stuck.
 *
 * `reason` is the model's one-line explanation and is `null` when the recommendations came from the
 * fallback, which the caller renders as a factual line rather than as prose from a model that never
 * ran.
 * @param {string} id asset id
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ alternatives: Array<{ assetId: string, name: string, category: string, description: string, reason: string|null }>, aiAssisted: boolean }>}
 */
export const alternatives = (id, signal) =>
  apiRequest(`/api/assets/${encodeURIComponent(id)}/alternatives`, { signal });
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
/**
 * Send one unit out of circulation for repair (ORG_ADMIN — SCRUM-141).
 *
 * A POST to an action sub-path rather than a PATCH of the unit's status, matching `/retire` and
 * `/approve`: what the admin is doing is an event with rules, not a field edit.
 *
 * The unit is addressed through the asset that owns it, and the server checks that relationship —
 * a unit id under the wrong asset is a 404.
 * @param {string} id asset id
 * @param {string} unitId
 * @returns {Promise<object>} the updated unit
 */
export const startMaintenance = (id, unitId) =>
  apiRequest(
    `/api/assets/${encodeURIComponent(id)}/units/${encodeURIComponent(unitId)}/maintenance`,
    { method: 'POST', body: {} },
  );
/**
 * Bring a repaired unit back into circulation (ORG_ADMIN — SCRUM-141).
 *
 * Safe to call twice: the server answers 200 for a unit that is already available, because the
 * caller's goal is met, and records nothing the second time.
 * @param {string} id asset id
 * @param {string} unitId
 * @returns {Promise<object>} the updated unit
 */
export const endMaintenance = (id, unitId) =>
  apiRequest(
    `/api/assets/${encodeURIComponent(id)}/units/${encodeURIComponent(unitId)}/maintenance/end`,
    { method: 'POST', body: {} },
  );
/**
 * Read one asset's complete chain of custody (ORG_ADMIN — SCRUM-29).
 *
 * Read-only, like the audit trail it draws from: there is no call here to change or remove an
 * event, because the API exposes none (SR-8).
 * @param {string} id asset id
 * @param {{ page?: number, limit?: number }} [params]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ asset: object, items: object[], total: number, page: number, limit: number }>}
 */
export const history = (id, params = {}, signal) =>
  apiRequest(`/api/assets/${encodeURIComponent(id)}/history${query(params)}`, { signal });
