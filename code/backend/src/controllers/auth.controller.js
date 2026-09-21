// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: auth HTTP handlers: set/clear HttpOnly cookies, uniform responses (SCRUM-101); changePassword handler
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; extended for the member-lifecycle work.

/**
 * HTTP layer for `/api/auth`: translate requests into auth-service calls, and manage the session
 * cookies.
 *
 * Controllers in this codebase are deliberately thin — read validated input, call a service, choose a
 * status code — and this one is the exception only in that cookies are an HTTP concern, so setting and
 * clearing them belongs here rather than in the service.
 *
 * The tokens themselves never appear in a response body. They go into `httpOnly` cookies, so the SPA
 * receives only the user object and the browser handles the credential.
 *
 * Exports: `setSessionCookies`, `clearSessionCookies`, and the handlers `login`, `refresh`, `logout`,
 * `me`, `changePassword`.
 */
import * as authService from '../services/auth.service.js';
import { AuthError } from '../utils/errors.js';
import {
  ACCESS_COOKIE,
  accessCookieOptions,
  clearAccessCookieOptions,
  clearRefreshCookieOptions,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from '../utils/tokens.js';

/**
 * Write both session cookies onto the response.
 *
 * Shared with organizations.controller, since creating an organisation also starts a session. Each
 * cookie gets its own expiry and path from utils/tokens.js — the access cookie scoped to `/api`, the
 * refresh cookie to `/api/auth`.
 * @param {import('express').Response} res
 * @param {{ accessToken: string, accessExpiresAt: Date, refreshToken: string, refreshExpiresAt: Date }} tokens
 */
export function setSessionCookies(
  res,
  { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt },
) {
  res.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions(accessExpiresAt));
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(refreshExpiresAt));
}

/**
 * Remove both session cookies.
 *
 * The clearing options must match the attributes the cookies were set with, or the browser keeps
 * them; that is why they come from the same module rather than being written out here.
 * @param {import('express').Response} res
 */
export function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, clearAccessCookieOptions());
  res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
}

/**
 * `POST /api/auth/login` — authenticate and start a session.
 *
 * Any refresh cookie the browser still holds is passed to the service so the old session can be
 * revoked. The response body carries only the user; the tokens go into cookies.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function login(req, res) {
  const { user, ...tokens } = await authService.login(req.body, {
    presentedRefreshToken: req.cookies?.[REFRESH_COOKIE],
  });
  setSessionCookies(res, tokens);
  res.status(200).json({ user });
}

/**
 * `POST /api/auth/refresh` — rotate the refresh token and reissue both cookies.
 *
 * The explicit try/catch is the point of this handler. When the service rejects with an `AuthError`,
 * the session is genuinely over, so the cookies are cleared — otherwise the SPA would retry with a
 * token that can never work again. Any other failure (a database blip, a 5xx) leaves the cookies
 * alone: the session is still valid server-side, and clearing them would turn a transient error into
 * a logout.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function refresh(req, res, next) {
  try {
    const { user, ...tokens } = await authService.refresh(req.cookies?.[REFRESH_COOKIE]);
    setSessionCookies(res, tokens);
    res.status(200).json({ user });
  } catch (err) {
    // A dead refresh token means the browser session is over; clear cookies so the SPA stops
    // retrying. Transient failures (5xx) keep the cookies: the session is still valid server-side.
    if (err instanceof AuthError) {
      clearSessionCookies(res);
    }
    next(err);
  }
}

/**
 * `POST /api/auth/logout` — revoke the session server-side and clear the cookies.
 *
 * Answers 204: there is nothing to say, and the client's own state is the only thing left to update.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function logout(req, res) {
  await authService.logout(req.auth, req.cookies?.[REFRESH_COOKIE]);
  clearSessionCookies(res);
  res.status(204).end();
}

/**
 * `GET /api/auth/me` — return the current user and organisation.
 *
 * The SPA calls this on load to decide whether it has a session; a 401 here is how it learns to show
 * the login page.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function me(req, res) {
  const result = await authService.me(req.auth);
  res.status(200).json(result);
}

/**
 * `POST /api/auth/change-password` — set a new password and replace the session.
 *
 * The service ends every session the user had and starts a new one, so the response sets fresh
 * cookies: the browser leaves this call holding the only live session, and it is no longer restricted.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function changePassword(req, res) {
  const { user, ...tokens } = await authService.changePassword(req.auth, req.body);
  setSessionCookies(res, tokens);
  res.status(200).json({ user });
}

/**
 * `POST /api/auth/forgot-password` → 202, always.
 *
 * Accepted, not OK: the request has been taken, and whether a mail followed is deliberately not
 * disclosed. The body is a fixed message so that an unknown address, a real one and a provider
 * outage are identical to the caller (SCRUM-22).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export async function forgotPassword(req, res) {
  await authService.requestPasswordReset(req.body);
  res.status(202).json({ message: 'If that account exists, a reset link is on its way.' });
}

/**
 * `POST /api/auth/reset-password` → 204.
 *
 * No session is issued: the caller signs in with the new password, which also proves it works.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export async function resetPassword(req, res) {
  await authService.resetPassword(req.body);
  res.status(204).end();
}
