// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: the middleware chain in the exact order of SDD §3 / architecture review
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import cookieParser from 'cookie-parser';
import express from 'express';
import { env } from './config/env.js';
import { authenticate } from './middleware/authenticate.js';
import { denyByDefault } from './middleware/authorize.js';
import { createCors } from './middleware/cors.js';
import { createErrorHandler, notFound } from './middleware/errorHandler.js';
import { authRateLimiter } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { scopeTenant } from './middleware/scopeTenant.js';
import {
  createOriginCheck,
  requireJsonForStateChanges,
  securityHeaders,
} from './middleware/security.js';
import { assertRoutesDeclarePermission } from './routes/define.js';
import { registerRoutes } from './routes/index.js';

export const JSON_BODY_LIMIT = '100kb';

/**
 * Assemble the Express app. Middleware order is the security design; do not reorder without
 * updating SDD §3.
 * @param {{ config?: typeof env, skipRouteAssertion?: boolean }} [options] skipRouteAssertion exists only so tests can prove the runtime gate
 */
export function createApp({ config = env, skipRouteAssertion = false } = {}) {
  const app = express();

  // Behind Render's proxy in production so req.ip / secure cookies reflect the real client.
  const hops = config.TRUST_PROXY ?? (config.isProduction ? 1 : 0);
  app.set('trust proxy', hops > 0 ? hops : false);
  app.disable('x-powered-by');
  // Express 5 default ('simple') parses ?a[$ne]=1 as a flat key, never a nested object. Keep it.
  app.set('query parser', 'simple');

  // 1. Correlation id on every request/response.
  app.use(requestId);

  // 2. Security headers (helmet incl. HSTS) and CORS allowlist.
  app.use(securityHeaders);
  app.use(createCors(config.CORS_ORIGINS));

  // 3. JSON only. State-changing requests must be application/json and, if a browser sent an
  //    Origin, it must be ours (CSRF defence together with SameSite=Lax cookies).
  app.use(requireJsonForStateChanges);
  app.use(createOriginCheck(config.CORS_ORIGINS));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  app.use(cookieParser());

  // Liveness probe for Render / Compose. Outside /api on purpose: no auth, no tenant.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // 4. Brute-force protection on the auth endpoints only.
  app.use('/api/auth', authRateLimiter);

  // 5. Verify the access cookie → req.auth (public routes pass through).
  app.use('/api', authenticate);
  // 6. req.orgId comes only from req.auth; strip client-supplied tenant ids.
  app.use('/api', scopeTenant);
  // 7. Deny by default; each route's authorize(permission) is the only thing that grants.
  app.use('/api', denyByDefault);

  // 8–9. Routers: every route = authorize(permission) → validate(schemas) → controller → service → repository.
  registerRoutes(app);
  if (!skipRouteAssertion) {
    assertRoutesDeclarePermission(app);
  }

  // 10. Uniform 404 and the single error middleware.
  app.use(notFound);
  app.use(createErrorHandler({ isProduction: config.isProduction }));

  return app;
}

const app = createApp();
export default app;
