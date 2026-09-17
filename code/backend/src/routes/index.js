// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: mounts every resource router under /api with mount() so listRoutes() can prove permissions
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { assetsRouter } from './assets.routes.js';
import { auditRouter } from './audit.routes.js';
import { authRouter } from './auth.routes.js';
import { dashboardRouter } from './dashboard.routes.js';
import { createRouter, mount } from './define.js';
import { organizationsRouter } from './organizations.routes.js';
import { requestsRouter } from './requests.routes.js';
import { usersRouter } from './users.routes.js';

/** @param {import('express').Application} app */
export function registerRoutes(app) {
  const api = createRouter();
  mount(api, '/auth', authRouter);
  mount(api, '/organizations', organizationsRouter);
  mount(api, '/users', usersRouter);
  mount(api, '/assets', assetsRouter);
  mount(api, '/requests', requestsRouter);
  mount(api, '/audit', auditRouter);
  mount(api, '/dashboard', dashboardRouter);
  mount(app, '/api', api);
  return app;
}
