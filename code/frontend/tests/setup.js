// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: MSW lifecycle (unhandled requests are errors), jest-dom matchers, RTL cleanup
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Per-file frontend test setup: jest-dom matchers, the mock API server, and cleanup.
 *
 * The MSW server intercepts `fetch` for the whole run so tests exercise the real API layer — request
 * shape, error parsing, the refresh-and-retry path — against scripted responses rather than a mocked
 * client.
 *
 * `onUnhandledRequest: 'error'` is the decision worth knowing about: any request without a handler
 * fails the test instead of hanging or silently returning nothing, so a component that starts calling
 * a new endpoint cannot do so unnoticed. Handlers are reset and the DOM unmounted after each test, so
 * a per-test override cannot leak into the next one.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
