// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: env-driven CORS allowlist with credentials; never reflects an arbitrary Origin (SR-14)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Chain step 2: cross-origin request policy.
 *
 * Under OD-1 Option A the SPA and the API share an origin in production (a Vercel rewrite) and in
 * development (the Vite proxy), so in practice CORS rarely comes into play. It is configured anyway,
 * strictly, for tooling and for the possibility of split origins later.
 */
import cors from 'cors';

/**
 * Build the CORS middleware for an exact-match origin allowlist.
 *
 * The origin callback answers with a boolean rather than echoing the request's origin, which is the
 * whole point: reflecting an arbitrary `Origin` back with `credentials: true` would let any site
 * read authenticated responses. A missing `Origin` means it is not a cross-origin browser request,
 * so no CORS headers are needed; an unknown one gets no headers and the browser blocks the response.
 *
 * `credentials: true` is required because the session travels in cookies, and only `Content-Type`
 * is accepted as a request header — the narrower that list, the fewer preflights succeed by accident.
 * @param {string[]} allowlist exact origins, e.g. https://safedrop.vercel.app
 * @returns {import('express').RequestHandler}
 */
export function createCors(allowlist) {
  const allowed = new Set(allowlist);
  return cors({
    origin(origin, callback) {
      // No Origin header → not a cross-origin browser request → no CORS headers needed.
      // Unknown Origin → no CORS headers (the browser blocks the response); never echo it back.
      callback(null, Boolean(origin) && allowed.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
}
