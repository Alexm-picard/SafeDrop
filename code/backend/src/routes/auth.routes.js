// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/auth routes with permissions and Zod schemas (SCRUM-101); POST /api/auth/change-password
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; extended for the member-lifecycle work.

/**
 * Routes for `/api/auth`: the session endpoints (SDD §6.2).
 *
 * `POST /login` and `POST /refresh` are two of the three public routes in the system — they must be
 * reachable without a session, since they are how one is obtained. `POST /logout` and `GET /me`
 * require only `session:self`, the permission every role holds, so any signed-in user can inspect or
 * end their own session.
 *
 * The login body accepts `orgSlug` + email + password: because email is unique per organisation
 * (OD-3), the slug is what selects the tenant to authenticate against.
 *
 * Exports: `authRouter`, and `loginBody` / `changePasswordBody` for reuse in tests.
 */
import { z } from 'zod';
import * as auth from '../controllers/auth.controller.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { email, emptyBody, orgSlug, password } from './schemas.js';

/**
 * Body schema for `POST /api/auth/login`.
 *
 * The password is bounded but otherwise unvalidated here: this route compares a password rather than
 * setting one, so strength rules (length, byte cap) belong at creation time. Enforcing them at login
 * would reject existing users whose password predates a rule change, and would leak which rules are
 * in force to anyone guessing.
 */
export const loginBody = z.object({
  orgSlug,
  email,
  // Max length only: the service compares whatever was typed; format rules apply at creation time.
  password: z.string().min(1).max(1024),
});

/**
 * Body schema for `POST /api/auth/change-password`.
 *
 * The *current* password is bounded but otherwise unchecked, for the same reason as at login: it is
 * compared, not set. The *new* one goes through the shared `password` schema, so the strength and
 * 72-byte rules apply — this is a creation path.
 */
export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: password,
});

/**
 * Body schema for `POST /api/auth/forgot-password`.
 *
 * The organisation slug is required for the same reason login needs it: email is unique per
 * organisation (OD-3), so an address alone does not identify an account.
 */
export const forgotPasswordBody = z.object({ orgSlug, email });

/**
 * Body schema for `POST /api/auth/reset-password`.
 *
 * The token is bounded rather than pattern-matched: it is looked up by hash, and a stricter schema
 * here would answer "is this shaped like one of our tokens?" before the lookup does.
 */
export const resetPasswordBody = z.object({
  token: z.string().min(1).max(512),
  newPassword: password,
});

export const authRouter = createRouter();

defineRoute(
  authRouter,
  { method: 'POST', path: '/login', public: true, schemas: { body: loginBody } },
  auth.login,
);
defineRoute(
  authRouter,
  { method: 'POST', path: '/refresh', public: true, schemas: { body: emptyBody.optional() } },
  auth.refresh,
);
defineRoute(
  authRouter,
  {
    method: 'POST',
    path: '/logout',
    permission: PERMISSIONS.SESSION_SELF,
    schemas: { body: emptyBody.optional() },
  },
  auth.logout,
);
defineRoute(
  authRouter,
  { method: 'GET', path: '/me', permission: PERMISSIONS.SESSION_SELF },
  auth.me,
);
// Both reset routes are public: someone who cannot sign in is, by definition, not signed in. The
// credential for the second one is the mailed token (SCRUM-22).
defineRoute(
  authRouter,
  {
    method: 'POST',
    path: '/forgot-password',
    public: true,
    schemas: { body: forgotPasswordBody },
  },
  auth.forgotPassword,
);
defineRoute(
  authRouter,
  {
    method: 'POST',
    path: '/reset-password',
    public: true,
    schemas: { body: resetPasswordBody },
  },
  auth.resetPassword,
);
defineRoute(
  authRouter,
  {
    method: 'POST',
    path: '/change-password',
    permission: PERMISSIONS.PASSWORD_SELF,
    schemas: { body: changePasswordBody },
  },
  auth.changePassword,
);
