// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: gate that confines a session using an admin-set password to the change-password route
// Human Contributions: pending team review
// Notes: Written for SCRUM-22. Must be reviewed and tested by the owning team member before merge.

/**
 * Chain step 5b: a session still using someone else's password may only change it.
 *
 * When an admin sets a password — at invitation, or through a reset — two people know it, and one
 * of them wrote it down somewhere. The account is therefore held at arm's length: every route under
 * `/api` answers 403 until the person chooses their own password, except the handful needed to do
 * exactly that.
 *
 * Enforced here rather than in the SPA. A guard in the frontend is a redirect anyone can skip with
 * curl; this is the rule (SR-1). It runs after `authenticate`, because it needs `req.auth`, and
 * before `scopeTenant` and the routes, because nothing else should happen first.
 *
 * The flag rides in the access token, so this costs no database read. A change issues a fresh token
 * without it, and a rotation re-reads it, so the gate lifts as soon as the password changes — and
 * closes within one refresh if an admin resets the password mid-session.
 */
import { ForbiddenError } from '../utils/errors.js';
import { normalizePath } from '../utils/permissions.js';

/**
 * What a confined session may still reach.
 *
 * `change-password` is the way out. `logout` must work, or the only escape from a forced change
 * would be clearing cookies by hand. `me` is what the SPA reads to discover it must show the
 * change-password screen at all, so refusing it would leave the frontend unable to explain itself.
 */
const ALLOWED = Object.freeze([
  Object.freeze({ method: 'POST', path: '/api/auth/change-password' }),
  Object.freeze({ method: 'POST', path: '/api/auth/logout' }),
  Object.freeze({ method: 'GET', path: '/api/auth/me' }),
]);

/**
 * Refuse everything but the escape routes while `mustChangePassword` is set.
 *
 * Unauthenticated requests pass straight through: they have no `req.auth`, and whether they are
 * allowed is the next middleware's business, not this one's.
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 * @returns {void} calls `next(ForbiddenError)` (403, `PASSWORD_CHANGE_REQUIRED`) when confined
 */
export function requirePasswordChange(req, _res, next) {
  if (!req.auth?.mustChangePassword) {
    return next();
  }
  const path = normalizePath(req.originalUrl ?? req.url ?? '');
  if (ALLOWED.some((route) => route.method === req.method && route.path === path)) {
    return next();
  }
  const error = new ForbiddenError('Choose your own password before continuing');
  error.code = 'PASSWORD_CHANGE_REQUIRED';
  return next(error);
}
