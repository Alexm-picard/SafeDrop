// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~80% (Vite template base; dev proxy added per SDD §6.3 / OD-1 Option A)
// AI-Assisted Areas: /api dev proxy so cookies stay first-party in local development
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Vite configuration for the SPA (SDD §6.3, OD-1 Option A).
 *
 * The dev proxy is the point of this file. The SPA calls `/api/*` on its own origin, and Vite forwards
 * those calls to the backend, so the session cookies are first-party in development exactly as they
 * are in production (where Vercel does the same through a rewrite). Without it, the browser would
 * treat the API as a third party and refuse to store the cookies.
 *
 * `changeOrigin: false` is deliberate: the browser's `Origin` and `Host` headers must reach the API
 * unchanged, or its origin allowlist would see the proxy rather than `localhost:5173` and reject every
 * state-changing request.
 *
 * `VITE_DEV_PROXY_TARGET` lets Docker Compose point at `http://backend:4000` instead of localhost.
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The SPA calls /api/* on its own origin. Locally Vite forwards that to the API so the auth cookies
// are same-site (OD-1 Option A). In production Vercel does the same via vercel.json rewrites.
const proxyTarget = process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: false, // keep the browser's Origin/Host so the API's allowlist sees localhost:5173
      },
    },
  },
});
