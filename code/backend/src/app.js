// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: the middleware chain in the exact order of SDD §3 / architecture review
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Express application assembly — the middleware chain that every request passes through.
 *
 * The order of the `app.use()` calls below **is** the security design (SDD §3), and the numbered
 * comments correspond to that section. Each layer assumes the ones above it have run: the tenant
 * scope is trustworthy only because authentication ran first, authorization is meaningful only
 * because the tenant is fixed, and validation happens after authorization so an unauthorized caller
 * cannot use schema errors to probe the API. Reordering these lines changes what the system
 * guarantees — do not do it without updating the SDD.
 *
 * The app is built by a factory so tests can vary the configuration, and a default instance is
 * exported for the server and for supertest.
 */
import cookieParser from 'cookie-parser';
import express from 'express';
import { pingDb } from './config/db.js';
import { env } from './config/env.js';
import { authenticate } from './middleware/authenticate.js';
import { requirePasswordChange } from './middleware/requirePasswordChange.js';
import { denyByDefault } from './middleware/authorize.js';
import { createCors } from './middleware/cors.js';
import { createErrorHandler, notFound } from './middleware/errorHandler.js';
import { authRateLimiter, passwordResetRateLimiter } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { scopeTenant } from './middleware/scopeTenant.js';
import {
  createOriginCheck,
  noStore,
  requireJsonForStateChanges,
  securityHeaders,
} from './middleware/security.js';
import { assertRoutesDeclarePermission } from './routes/define.js';
import { registerRoutes } from './routes/index.js';
import { ServiceUnavailableError } from './utils/errors.js';

/**
 * Maximum accepted JSON body size. Small on purpose: no endpoint in this API takes bulk data, and a
 * tight limit is the cheapest defence against a memory-exhaustion attempt. Exceeding it is a 413.
 */
export const JSON_BODY_LIMIT = '100kb';

/**
 * Assemble the Express app.
 *
 * Before the chain, three app settings matter. `trust proxy` is set to a number of hops (1 on Render)
 * so `req.ip` and secure-cookie detection reflect the real client — set too permissively, a client
 * could spoof `X-Forwarded-For` and evade the rate limiter. `x-powered-by` is disabled so the
 * response does not advertise the framework. The query parser is pinned to `simple`, which parses
 * `?a[$ne]=1` as one flat key rather than a nested object — the extended parser would hand a
 * ready-made Mongo operator to the validation layer.
 *
 * Then the chain, in order:
 *  1. `requestId` — correlation id on every request and response.
 *  2. `securityHeaders`, `noStore`, `createCors` — helmet (including HSTS), `Cache-Control:
 *     no-store` on every response, and the origin allowlist.
 *  3. `requireJsonForStateChanges`, `createOriginCheck`, `express.json`, `cookieParser` — JSON-only
 *     body handling and the CSRF defences.
 *     `/health` is registered here, deliberately outside `/api`: a health probe needs no session
 *     and belongs to no tenant. It pings the database, so it answers 503 when the process is up
 *     but could not serve a real request.
 *  4. `authRateLimiter` on `/api/auth` only — brute-force protection where credentials are checked.
 *  5. `authenticate` on `/api` — the access cookie becomes `req.auth`, or the request is refused.
 *  5b. `requirePasswordChange` on `/api` — a session using an admin-set password may only change
 *     it, log out, or read `/me`.
 *  6. `scopeTenant` on `/api` — `req.orgId` from the token, client-supplied tenant ids stripped.
 *  7. `denyByDefault` on `/api` — every request starts denied.
 *  8–9. `registerRoutes` — each route is authorize → validate → controller → service → repository.
 *  10. `notFound` and the error handler — one 404 shape and one place errors become responses.
 *
 * `assertRoutesDeclarePermission` then proves at boot that every registered route declares who may
 * call it, so a route missing its permission stops the server rather than serving traffic.
 * @param {{ config?: typeof env, skipRouteAssertion?: boolean }} [options] `skipRouteAssertion` exists only so tests can reach the runtime gate; never set it in production
 * @returns {import('express').Application}
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

  // 2. Security headers (helmet incl. HSTS), no caching of any response, and the CORS allowlist.
  app.use(securityHeaders);
  app.use(noStore);
  app.use(createCors(config.CORS_ORIGINS));

  // 3. JSON only. State-changing requests must be application/json and, if a browser sent an
  //    Origin, it must be ours (CSRF defence together with SameSite=Lax cookies).
  app.use(requireJsonForStateChanges);
  app.use(createOriginCheck(config.CORS_ORIGINS));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  app.use(cookieParser());

  // Health probe for Render / Compose. Outside /api on purpose: no auth, no tenant.
  // 503 when the database does not answer; why it failed goes to the log, never the client.
  app.get('/health', async (_req, res) => {
    try {
      await pingDb();
    } catch (err) {
      throw new ServiceUnavailableError(undefined, err);
    }
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  });

  // 4. Brute-force protection on the auth endpoints only. The password-reset pair gets its own,
  //    tighter limiter first: those routes always answer success, so the login limiter — which
  //    counts failures — would never count them (SCRUM-22).
  app.use(['/api/auth/forgot-password', '/api/auth/reset-password'], passwordResetRateLimiter);
  app.use('/api/auth', authRateLimiter);

  // 5. Verify the access cookie → req.auth (public routes pass through).
  app.use('/api', authenticate);
  // 5b. A session still using a password an admin chose may only change it (SCRUM-22).
  app.use('/api', requirePasswordChange);
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
