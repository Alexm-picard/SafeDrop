// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed calls for /api/requests/* (SCRUM-119, SCRUM-120, SCRUM-123, SCRUM-135); SCRUM-205 initiate-return, reject-return, expire-approvals
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Checkout request endpoints.
 *
 * Each workflow transition is its own call — approve, deny, cancel, checkout, return — mirroring the
 * API, where each has its own permission and produces its own audit event.
 */
import { apiRequest } from './api';
/**
 * Build a request URL, optionally with a transition action appended.
 *
 * The id is encoded, so it cannot inject a path segment and turn a read into an action.
 * @param {string} id
 * @param {string} [action] e.g. 'approve'
 * @returns {string}
 */
const path = (id, action) => `/api/requests/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
/**
 * List checkout requests, optionally filtered by state.
 *
 * `state: 'PENDING'` is what the approval queue asks for. Which requests come back is the API's
 * decision: a member sees only their own.
 * @param {{ page?: number, limit?: number, state?: string }} [params]
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
  return apiRequest(`/api/requests${qs ? `?${qs}` : ''}`, { signal });
};
/**
 * Read one checkout request.
 * @param {string} id
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>}
 */
export const get = (id, signal) => apiRequest(path(id), { signal });
/**
 * Open a checkout request for a unit and a date range.
 *
 * The requester is taken from the session server-side, so it is not part of the body.
 * @param {{ unitId: string, neededFrom: string|Date, neededTo: string|Date, note?: string }} input
 * @returns {Promise<object>}
 */
export const create = (input) => apiRequest('/api/requests', { method: 'POST', body: input });
/**
 * Approve a pending request, with an optional note. Requires `requests:decide`.
 * @param {string} id
 * @param {string} [note]
 * @returns {Promise<object>}
 */
export const approve = (id, note = '') =>
  apiRequest(path(id, 'approve'), { method: 'POST', body: { note } });
/**
 * Deny a pending request, with an optional note. Requires `requests:decide`.
 * @param {string} id
 * @param {string} [note]
 * @returns {Promise<object>}
 */
export const deny = (id, note = '') =>
  apiRequest(path(id, 'deny'), { method: 'POST', body: { note } });
/**
 * Withdraw one's own request.
 * @param {string} id
 * @returns {Promise<object>}
 */
export const cancel = (id) => apiRequest(path(id, 'cancel'), { method: 'POST', body: {} });
/**
 * Record handing the item over: by the borrower ("I've picked it up") or by anyone holding
 * `requests:handoff` (SCRUM-205).
 * @param {string} id
 * @returns {Promise<object>}
 */
export const checkout = (id) => apiRequest(path(id, 'checkout'), { method: 'POST', body: {} });
/**
 * Record the item coming back, with any condition change. Requires `requests:handoff`, and the
 * caller must not be the requester unless nobody else could confirm (SCRUM-205). Confirms a pending
 * return, or records a walk-in one.
 *
 * Named `returnUnit` because `return` is a reserved word.
 * @param {string} id
 * @param {{ condition?: string, note?: string }} [input]
 * @returns {Promise<object>}
 */
export const returnUnit = (id, input = {}) =>
  apiRequest(path(id, 'return'), { method: 'POST', body: input });
/**
 * Start a return as the borrower, reporting the condition (SCRUM-205). The item stays out until
 * someone else confirms it.
 * @param {string} id
 * @param {{ condition: string, note?: string }} input
 * @returns {Promise<object>}
 */
export const initiateReturn = (id, input) =>
  apiRequest(path(id, 'initiate-return'), { method: 'POST', body: input });
/**
 * Refuse a pending return that never arrived, with a reason (SCRUM-205). Requires
 * `requests:handoff`, and the caller must not be the requester.
 * @param {string} id
 * @param {string} reason
 * @returns {Promise<object>}
 */
export const rejectReturn = (id, reason) =>
  apiRequest(path(id, 'reject-return'), { method: 'POST', body: { reason } });
/**
 * Expire the organisation's uncollected approvals now (SCRUM-205). ORG_ADMIN only.
 * @returns {Promise<{ expired: number }>}
 */
export const expireApprovals = () =>
  apiRequest('/api/requests/expire-approvals', { method: 'POST', body: {} });
