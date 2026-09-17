// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: /api/auth routes with permissions and Zod schemas (SCRUM-102)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { z } from 'zod';
import * as auth from '../controllers/auth.controller.js';
import { PERMISSIONS } from '../utils/permissions.js';
import { createRouter, defineRoute } from './define.js';
import { email, emptyBody, orgSlug } from './schemas.js';

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
