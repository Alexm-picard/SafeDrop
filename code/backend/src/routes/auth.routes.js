// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/auth routes with permissions and Zod schemas (SCRUM-102)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
 * Exports: `authRouter`, and `loginBody` for reuse in tests.
 */
import { z } from 'zod';
import * as auth from '../controllers/auth.controller.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { email, emptyBody, orgSlug } from './schemas.js';

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
