// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: jsdom + RTL + MSW setup, 80% line-coverage gate (SPPP §6a/§6d)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Vitest configuration for the frontend (SPPP §6a/§6d).
 *
 * Runs component tests in jsdom with React Testing Library and MSW, wired up by `tests/setup.js`.
 * Mocking at the network layer rather than mocking the API client means the tests exercise the real
 * request building, error parsing and refresh-retry logic in services/api.js.
 *
 * `css: false` skips stylesheet processing, which the assertions never look at.
 *
 * Coverage is gated at 80% of lines. `main.jsx` is excluded as the DOM mount point and `types/` as
 * pure JSDoc with no runtime code — both would only dilute the figure.
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/types/**'],
      thresholds: { lines: 80 },
    },
  },
});
