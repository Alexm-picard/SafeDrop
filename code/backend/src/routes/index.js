// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: mounts every resource router under /api with mount() so listRoutes() can prove permissions
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The API's mount table: every resource router, assembled under `/api`.
 *
 * This is the one place that shows the whole URL surface of the backend at a glance. Each resource
 * router is mounted through `mount()` so that the boot-time assertion in define.js can rebuild full
 * paths and check every route it contains.
 */
import { assetsRouter } from './assets.routes.js';
import { auditRouter } from './audit.routes.js';
import { authRouter } from './auth.routes.js';
import { dashboardRouter } from './dashboard.routes.js';
import { createRouter, mount } from './define.js';
import { organizationsRouter } from './organizations.routes.js';
import { requestsRouter } from './requests.routes.js';
import { usersRouter } from './users.routes.js';

/**
 * Mount every resource router onto the app under `/api`.
 *
 * The routers are first collected on one `api` router, which is then mounted as a whole, so the
 * `/api` prefix is written once and the authentication chain in app.js has a single mount point to
 * attach to.
 * @param {import('express').Application} app
 * @returns {import('express').Application} the same app, for chaining
 */
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
