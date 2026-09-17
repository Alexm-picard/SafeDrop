// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: env-driven CORS allowlist with credentials; never reflects an arbitrary Origin (SR-14)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import cors from 'cors';

/**
 * With OD-1 Option A the SPA and API share an origin in production (Vercel rewrite) and in dev
 * (Vite proxy), so CORS rarely triggers. It stays configured for tooling and future split origins.
 * @param {string[]} allowlist exact origins, e.g. https://safedrop.vercel.app
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
