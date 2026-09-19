// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: API client for member list, invite and role change
// Human Contributions: pending team review
// Notes: Verified through MembersPage.test.jsx against the MSW mock of the real contract. Must be reviewed by the owning team member before merge.

/**
 * Member-management endpoints (ORG_ADMIN only): list, invite, change role.
 *
 * All three act on the caller's own organisation — the tenant is taken from the session by the API, so
 * nothing here carries an organisation id, and none could be made to.
 */
import { apiRequest } from './api';

/**
 * List the organisation's members, oldest first.
 *
 * `undefined` parameters are left out of the query string rather than sent as the string
 * `"undefined"`, which the API's pagination schema would reject with a 400.
 * @param {{ page?: number, limit?: number }} [params]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ items: import('../types/api').User[], total: number, page: number, limit: number }>}
 */
export const list = (params = {}, signal) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return apiRequest(`/api/users${qs ? `?${qs}` : ''}`, { signal });
};

/**
 * Add someone to the organisation with an initial password the admin sets.
 *
 * Iteration 1 has no email service, so the admin chooses the password and shares it out of band; the
 * member signs in with it. The password is sent once and never returned. It is validated by the API like
 * any password (at least 10 characters, at most 72 bytes).
 * @param {{ email: string, name: string, password: string, role?: string }} input
 * @returns {Promise<{ user: import('../types/api').User }>}
 */
export const invite = (input) => apiRequest('/api/users/invite', { method: 'POST', body: input });

/**
 * Change a member's role.
 * @param {string} userId
 * @param {import('../types/api').Role} role
 * @returns {Promise<{ user: import('../types/api').User }>}
 */
export const changeRole = (userId, role) =>
  apiRequest(`/api/users/${userId}/role`, { method: 'PATCH', body: { role } });
