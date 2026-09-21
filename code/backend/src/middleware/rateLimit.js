// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: express-rate-limit on /api/auth/* returning the standard 429 error shape (SR-12)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

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
 * How many password-reset requests one caller may make per window.
 *
 * Much tighter than the login limit, and it counts *every* request rather than only the failures:
 * `POST /api/auth/forgot-password` answers 202 whatever happens, by design, so there are no
 * failures to count. Without this, the endpoint would be an unmetered way to send mail to any
 * address someone cares to type, and an unmetered way to burn the provider's free tier.
 */
export const PASSWORD_RESET_RATE_LIMIT = 5;

/**
 * Build the limiter for the two password-reset routes (SCRUM-22).
 *
 * Shared by both: minting links and spending them are the same budget, so guessing tokens is
 * bounded by the same small number as asking for mail.
 * @param {{ limit?: number, windowMs?: number }} [options]
 * @returns {import('express').RequestHandler & { reset: () => void }}
 */
export function createPasswordResetRateLimiter({
  limit = PASSWORD_RESET_RATE_LIMIT,
  windowMs = AUTH_RATE_LIMIT_WINDOW_MS,
} = {}) {
  const store = new MemoryStore();
  const limiter = rateLimit({
    windowMs,
    limit,
    store,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    handler: (_req, _res, next) => next(new RateLimitError()),
    validate: env.isTest ? false : { trustProxy: false },
  });
  limiter.reset = () => store.resetAll();
  return limiter;
}

export const passwordResetRateLimiter = createPasswordResetRateLimiter();

/**
 * The window the organisation-creation limit is measured over (SCRUM-114).
 *
 * An hour rather than the fifteen minutes the auth limiters use. Creating an organisation is a
 * once-ever action for a legitimate caller, so the budget can be both small and slow to refill
 * without ever inconveniencing a real one — where a login limit has to refill quickly enough that
 * someone who mistyped their password is not locked out for the afternoon.
 */
export const ORG_CREATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Build the limiter for the public organisation bootstrap route (SCRUM-114, SR-12).
 *
 * **`skipSuccessfulRequests` is false, and that is the entire point of this limiter existing.**
 * Reusing `authRateLimiter` here would look right and do nothing: it skips successful requests, and
 * every spam organisation *succeeds* — the successes are the attack. A limiter that counts only
 * failures would leave the route exactly as open as it was.
 *
 * `POST /api/organizations` is public and creates a tenant plus its first ORG_ADMIN, so without a cap
 * it is both unbounded anonymous tenant creation and a cheap CPU-exhaustion vector: each call runs
 * bcrypt at cost 12, which measured at roughly 330ms of single-threaded CPU per anonymous request.
 *
 * GET and OPTIONS are skipped so a CORS preflight, or any read route added under this prefix later,
 * cannot spend the budget that exists to bound writes.
 * @param {{ limit?: number, windowMs?: number }} [options]
 * @returns {import('express').RequestHandler & { reset: () => void }}
 */
export function createOrgCreateRateLimiter({
  limit = env.RATE_LIMIT_ORG_CREATE_MAX,
  windowMs = ORG_CREATE_RATE_LIMIT_WINDOW_MS,
} = {}) {
  const store = new MemoryStore();
  const limiter = rateLimit({
    windowMs,
    limit,
    store,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Counts successes. See the note above: this is the difference between this limiter and the
    // auth one, and reusing the auth one instead would be a no-op against the actual threat.
    skipSuccessfulRequests: false,
    skip: (req) => req.method === 'GET' || req.method === 'OPTIONS',
    handler: (_req, _res, next) => next(new RateLimitError()),
    validate: env.isTest ? false : { trustProxy: false },
  });
  limiter.reset = () => store.resetAll();
  return limiter;
}

export const orgCreateRateLimiter = createOrgCreateRateLimiter();

/**
 * Clear every counter of the shared limiters.
 *
 * Test-only helper. Without it, a test that exercises failed logins — or that creates an
 * organisation — would leave a limiter tripped for whatever runs next in the same process.
 * @returns {void}
 */
export function resetAuthRateLimiter() {
  authRateLimiter.reset();
  passwordResetRateLimiter.reset();
  orgCreateRateLimiter.reset();
}
