// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: environment validation tests: fail-fast, production guards (SR-5, SR-11, SR-14)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Unit tests for environment validation (SR-11).
 *
 * Pins the documented defaults, the coercions (comma-separated origins into a trimmed list, strings
 * into booleans and numbers), and that every problem is reported in one error rather than one per
 * restart.
 *
 * The refusals are the point: in production, insecure cookies and an empty CORS allowlist must both
 * stop the boot, and an origin with a path or no scheme is rejected. A deploy that would be unsafe
 * never starts.
 */
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../../src/config/env.js';

const base = {
  MONGODB_URI: 'mongodb://localhost:27017/safedrop',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('applies documented defaults', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_IDLE_TTL: '30m',
      JWT_REFRESH_ABSOLUTE_TTL: '12h',
      CORS_ORIGINS: [],
      COOKIE_SECURE: false,
      LOG_LEVEL: 'info',
      RATE_LIMIT_AUTH_MAX: 20,
      isProduction: false,
      isTest: false,
    });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('parses CORS_ORIGINS into a trimmed list and booleans/numbers from strings', () => {
    const env = loadEnv({
      ...base,
      CORS_ORIGINS: ' http://a.test:5173 , https://b.test ',
      COOKIE_SECURE: 'true',
      PORT: '8080',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test:5173', 'https://b.test']);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.PORT).toBe(8080);
  });

  it('lists every missing or invalid variable in one error', () => {
    expect(() => loadEnv({ JWT_ACCESS_SECRET: 'short', JWT_ACCESS_TTL: '15' })).toThrow(
      /MONGODB_URI[\s\S]*JWT_ACCESS_SECRET[\s\S]*JWT_ACCESS_TTL/,
    );
  });

  it('refuses insecure production configuration', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
        CORS_ORIGINS: 'https://app.test',
      }),
    ).toThrow(/COOKIE_SECURE/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' })).toThrow(
      /CORS_ORIGINS/,
    );
    expect(
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://app.test',
      }).isProduction,
    ).toBe(true);
  });

  it('rejects origins that are not scheme://host', () => {
    expect(() => loadEnv({ ...base, CORS_ORIGINS: 'https://app.test/path' })).toThrow(
      /not an origin/,
    );
  });
});

describe('TRUST_PROXY', () => {
  it('is optional, numeric and non-negative', () => {
    expect(loadEnv(base).TRUST_PROXY).toBeUndefined();
    expect(loadEnv({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(() => loadEnv({ ...base, TRUST_PROXY: '-1' })).toThrow(/TRUST_PROXY/);
    expect(() => loadEnv({ ...base, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });
});
