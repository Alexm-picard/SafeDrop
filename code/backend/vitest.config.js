// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: vitest config with in-memory Mongo global setup and 80% line-coverage gate (SPPP §6a/§6d)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
