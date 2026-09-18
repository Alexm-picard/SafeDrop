// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: vitest config with in-memory Mongo global setup and 80% line-coverage gate (SPPP §6a/§6d)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Vitest configuration for the backend (SPPP §6a/§6d).
 *
 * The interesting part is the database strategy: `globalSetup` starts one in-memory MongoDB replica
 * set for the whole run, and `setupFiles` gives each test file its own database inside it with the
 * production indexes applied. Integration tests therefore run against real MongoDB semantics —
 * transactions, unique constraints, TTL — rather than a mock.
 *
 * The `env` block supplies a complete, valid environment, because config/env.js validates at import
 * time and would otherwise refuse to load. `RATE_LIMIT_AUTH_MAX` is lowered to 5 so the rate-limit
 * test does not need twenty failed logins, and `LOG_LEVEL: 'fatal'` keeps the output readable.
 *
 * The timeouts are generous because starting the in-memory server can be slow on a cold machine.
 * Coverage is gated at 80% of lines; server.js is excluded as it is process wiring with no logic to
 * test.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Starts one MongoMemoryReplSet for the whole run and hands its URI to every test file via inject().
    globalSetup: ['./tests/globalSetup.js'],
    // Per-file: connect Mongoose to a unique database, apply the index migration, wipe between tests.
    setupFiles: ['./tests/setup.js'],
    // Static env for config/env.js. tests/setup.js overrides MONGODB_URI with the in-memory URI.
    env: {
      NODE_ENV: 'test',
      PORT: '0',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/safedrop_test_placeholder?replicaSet=rs0',
      JWT_ACCESS_SECRET: 'test-only-access-secret-that-is-at-least-32-bytes-long',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_IDLE_TTL: '30m',
      JWT_REFRESH_ABSOLUTE_TTL: '12h',
      CORS_ORIGINS: 'http://localhost:5173,https://app.example.test',
      COOKIE_SECURE: 'false',
      LOG_LEVEL: 'fatal',
      RATE_LIMIT_AUTH_MAX: '5',
    },
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/server.js', 'src/services/ai/**'],
      thresholds: { lines: 80 },
    },
  },
});
