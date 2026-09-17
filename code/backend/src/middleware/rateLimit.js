// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: express-rate-limit on /api/auth/* returning the standard 429 error shape (SR-12)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { MemoryStore, rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { RateLimitError } from '../utils/errors.js';

export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Brute-force protection for the auth endpoints. Counts failed attempts per client IP; successful
 * logins/refreshes do not count, and GET /api/auth/me is skipped so page loads never trip it.
 * @param {{ limit?: number, windowMs?: number }} [options]
 */
export function createAuthRateLimiter({
  limit = env.RATE_LIMIT_AUTH_MAX,
  windowMs = AUTH_RATE_LIMIT_WINDOW_MS,
} = {}) {
  const store = new MemoryStore();
  const limiter = rateLimit({
    windowMs,
    limit,
    store,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skip: (req) => req.method === 'GET' || req.method === 'OPTIONS',
    handler: (_req, _res, next) => next(new RateLimitError()),
    // express-rate-limit's built-in misconfiguration checks stay on outside tests (e.g. an
    // unexpected X-Forwarded-For with TRUST_PROXY=0 is logged once); in tests they are noise.
    validate: env.isTest ? false : { trustProxy: false },
  });
  limiter.reset = () => store.resetAll();
  return limiter;
}

export const authRateLimiter = createAuthRateLimiter();

/** Test helper: clear all counters of the shared limiter. */
export function resetAuthRateLimiter() {
  authRateLimiter.reset();
}
