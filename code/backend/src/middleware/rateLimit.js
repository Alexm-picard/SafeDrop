// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: express-rate-limit on /api/auth/* returning the standard 429 error shape (SR-12)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Chain step 4: brute-force protection for the authentication endpoints.
 *
 * Only the auth routes are limited — the rest of the API is already behind a session — and only
 * *failed* attempts are counted, so a user working normally never approaches the limit while someone
 * guessing passwords does. The counter lives in memory, which is correct for a single instance and
 * the known limitation to revisit if the API is ever scaled out (a shared store would be needed).
 */
import { MemoryStore, rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { RateLimitError } from '../utils/errors.js';

export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Build the auth rate limiter: at most `limit` failed attempts per IP per window.
 *
 * `skipSuccessfulRequests` is what makes the limit target guessing rather than usage — a successful
 * login or refresh is not counted at all. GET and OPTIONS are skipped too, so `GET /api/auth/me`
 * firing on every page load can never exhaust the budget. Hitting the limit produces the API's own
 * `RateLimitError` (429) so the response matches every other error in shape.
 *
 * The store is exposed through a `reset()` on the returned limiter because tests share one process
 * and would otherwise inherit each other's counters.
 * @param {{ limit?: number, windowMs?: number }} [options]
 * @returns {import('express').RequestHandler & { reset: () => void }}
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

/**
 * Clear every counter of the shared limiter.
 *
 * Test-only helper. Without it, a test that exercises failed logins would leave the limiter tripped
 * for whatever runs next in the same process.
 * @returns {void}
 */
export function resetAuthRateLimiter() {
  authRateLimiter.reset();
}
