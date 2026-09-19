// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed calls for /api/auth/* (SCRUM-102); acceptInvite
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; acceptInvite added for the invitation-link work. Must be reviewed and tested by the owning team member before merge.

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
 * Accept an invitation: choose a password using the token from the invitation link.
 *
 * Public — the token is the credential. On success the API signs the new member in (cookies) and returns
 * their user and organisation. A used or unknown token and an expired one are different errors
 * (`INVITATION_INVALID` / `INVITATION_EXPIRED`), so a page can tell the user what to do next.
 * @param {{ token: string, password: string }} input
 * @returns {Promise<{ user: import('../types/api').User, organization: import('../types/api').Organization }>}
 */
export const acceptInvite = (input) =>
  apiRequest('/api/auth/accept-invite', { method: 'POST', body: input, retryOn401: false });
