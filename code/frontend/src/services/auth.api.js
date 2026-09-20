// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed calls for /api/auth/* (SCRUM-102)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Session endpoints: login, logout, refresh and "who am I".
 *
 * Every call here sets `retryOn401: false` except `me`. These *are* the session endpoints, so a 401
 * from them is the answer — wrong credentials, or a dead session — not something a refresh could fix,
 * and retrying refresh through itself would recurse. `me` keeps the default, so an expired access
 * token is transparently refreshed when the app checks who is signed in.
 */
import { apiRequest } from './api';
/**
 * Authenticate with `orgSlug` + email + password.
 *
 * The response carries the user; the tokens arrive as `httpOnly` cookies the browser stores itself.
 * @param {{ orgSlug: string, email: string, password: string }} credentials
 * @returns {Promise<{ user: object }>}
 */
export const login = (credentials) =>
  apiRequest('/api/auth/login', {
    method: 'POST',
    body: credentials,
    retryOn401: false,
  });
/**
 * End the current session server-side. Answers 204, so it resolves to `undefined`.
 * @returns {Promise<void>}
 */
export const logout = () =>
  apiRequest('/api/auth/logout', { method: 'POST', body: {}, retryOn401: false });
/**
 * Rotate the session directly.
 *
 * Normally unnecessary — services/api.js refreshes automatically on a 401 — and exported for tests
 * and for any deliberate refresh.
 * @returns {Promise<{ user: object }>}
 */
export const refresh = () =>
  apiRequest('/api/auth/refresh', { method: 'POST', body: {}, retryOn401: false });
/**
 * Read the signed-in user and their organisation.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ user: object, organization: object|null }>}
 */
export const me = (signal) => apiRequest('/api/auth/me', { signal });
/**
 * Replace the caller's own password.
 *
 * Answers with the user and a fresh session, so the forced-change flag clears in the same round
 * trip that sets the new password.
 * @param {{ currentPassword: string, newPassword: string }} input
 * @returns {Promise<{ user: object }>}
 */
export const changePassword = (input) =>
  apiRequest('/api/auth/change-password', { method: 'POST', body: input, retryOn401: false });
/**
 * Ask for a password-reset link (SCRUM-22).
 *
 * Always resolves when the request reaches the API, whether or not that account exists: the answer
 * is deliberately the same either way, so the caller cannot be used to discover who has an account.
 * @param {{ orgSlug: string, email: string }} input
 * @returns {Promise<{ message: string }>}
 */
export const forgotPassword = (input) =>
  apiRequest('/api/auth/forgot-password', { method: 'POST', body: input, retryOn401: false });
/**
 * Spend a reset link and set a new password. Answers 204, so it resolves to `undefined`.
 * @param {{ token: string, newPassword: string }} input
 * @returns {Promise<void>}
 */
export const resetPassword = (input) =>
  apiRequest('/api/auth/reset-password', { method: 'POST', body: input, retryOn401: false });
