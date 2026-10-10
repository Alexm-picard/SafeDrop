// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-150 ticket)
// AI-Assisted Areas: API client for SCRUM-149's /api/groups: list (the SCRUM-150 picker), and read, create, rename, delete and membership for the Groups screen (SCRUM-167)
// Human Contributions: reviewed and approved by Mateus Silva (PR #60, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Verified through AssetFormPage.test.jsx, GroupsPage.test.jsx and GroupDetailPage.test.jsx against the MSW mock. Reviewed before merge; see Human Contributions.

/**
 * User-group endpoints (ORG_ADMIN only, `groups:manage`).
 *
 * The groups are always the caller's own organisation's — the API takes the tenant from the session —
 * so nothing here carries an organisation id.
 */
import { apiRequest } from './api';

/**
 * List the organisation's groups, oldest first.
 *
 * `undefined` parameters are left out of the query string rather than sent as the string
 * `"undefined"`, which the API's pagination schema would reject with a 400.
 * @param {{ page?: number, limit?: number }} [params]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ items: import('../types/api').UserGroup[], total: number, page: number, limit: number }>}
 */
export const list = (params = {}, signal) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return apiRequest(`/api/groups${qs ? `?${qs}` : ''}`, { signal });
};

/**
 * Read one group with its members resolved (each a public user, including `deactivatedAt`).
 * @param {string} id
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ group: import('../types/api').UserGroup & { members: import('../types/api').User[] } }>}
 */
export const get = (id, signal) => apiRequest(`/api/groups/${id}`, { signal });

/**
 * Create an empty group. Members are added one at a time afterwards, each its own audit event.
 * @param {{ name: string, description?: string }} input
 * @returns {Promise<{ group: import('../types/api').UserGroup }>}
 */
export const create = (input) => apiRequest('/api/groups', { method: 'POST', body: input });

/**
 * Rename a group or change its description.
 * @param {string} id
 * @param {{ name?: string, description?: string }} patch
 * @returns {Promise<{ group: import('../types/api').UserGroup }>}
 */
export const update = (id, patch) =>
  apiRequest(`/api/groups/${id}`, { method: 'PATCH', body: patch });

/**
 * Delete a group. Answers 204 with no body.
 * @param {string} id
 * @returns {Promise<void>}
 */
export const remove = (id) => apiRequest(`/api/groups/${id}`, { method: 'DELETE' });

/**
 * Add one member. Adding someone already in the group is a harmless no-op.
 * @param {string} id the group
 * @param {string} userId
 * @returns {Promise<{ group: import('../types/api').UserGroup }>} without resolved members
 */
export const addMember = (id, userId) =>
  apiRequest(`/api/groups/${id}/members`, { method: 'POST', body: { userId } });

/**
 * Remove one member. Removing someone not in the group is a harmless no-op.
 * @param {string} id the group
 * @param {string} userId
 * @returns {Promise<{ group: import('../types/api').UserGroup }>} without resolved members
 */
export const removeMember = (id, userId) =>
  apiRequest(`/api/groups/${id}/members/${userId}`, { method: 'DELETE' });
