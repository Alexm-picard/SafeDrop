// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: auth HTTP handlers: set/clear HttpOnly cookies, uniform responses (SCRUM-102)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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

/** Shared with organizations.controller: writes both session cookies. */
export function setSessionCookies(
  res,
  { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt },
) {
  res.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions(accessExpiresAt));
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(refreshExpiresAt));
}

export function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, clearAccessCookieOptions());
  res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
}

export async function login(req, res) {
  const { user, ...tokens } = await authService.login(req.body, {
    presentedRefreshToken: req.cookies?.[REFRESH_COOKIE],
  });
  setSessionCookies(res, tokens);
  res.status(200).json({ user });
}

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

export async function logout(req, res) {
  await authService.logout(req.auth, req.cookies?.[REFRESH_COOKIE]);
  clearSessionCookies(res);
  res.status(204).end();
}

export async function me(req, res) {
  const result = await authService.me(req.auth);
  res.status(200).json(result);
}
