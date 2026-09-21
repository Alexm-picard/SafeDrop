// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Zod schema for every environment variable; fail-fast on missing/invalid values (SR-11)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Environment-variable contract for the backend: parse it once, validate it hard, freeze it.
 *
 * `.env` is loaded from the package directory or the repository root, then the whole environment is
 * run through a Zod schema that supplies defaults, coerces types and refuses values that would be
 * unsafe in production (insecure cookies, an empty CORS allow-list, a malformed origin). A bad
 * deploy therefore fails at boot with a list of every problem, instead of failing at the first
 * request (SR-11).
 *
 * Exports:
 *  - `envSchema` — the Zod schema, exported so tests can exercise it directly.
 *  - `loadEnv(source)` — validate a raw environment object and return a frozen, typed copy.
 *  - `env` — the validated environment for this process, loaded at import time.
 */
import dotenv from 'dotenv';
import { z } from 'zod';
import { DURATION_PATTERN } from '../utils/duration.js';

// Load `.env` from the package directory or the repository root. Existing process.env values win,
// so CI, Docker Compose and vitest's `env` block are never overridden by a stray local file.
dotenv.config({ path: ['.env', '../../.env'], quiet: true });

const duration = z.string().regex(DURATION_PATTERN, 'expected a duration such as 15m, 12h or 30s');
// Zod 4 applies .default() to the OUTPUT, so the default must sit before the transform.
const boolString = (fallback) =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: duration.default('15m'),
    JWT_REFRESH_IDLE_TTL: duration.default('30m'),
    JWT_REFRESH_ABSOLUTE_TTL: duration.default('12h'),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    COOKIE_SECURE: boolString('false'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
    // How many organisations one IP may create per hour (SR-12, SCRUM-114). Far lower than the auth
    // limit because the two protect against different things: that one bounds guessing, this one
    // bounds *successful* use of a public route that creates a tenant and an admin account each time.
    RATE_LIMIT_ORG_CREATE_MAX: z.coerce.number().int().positive().default(5),
    // Number of reverse-proxy hops to trust for req.ip (Render: 1). Default: 1 in production, 0 otherwise.
    TRUST_PROXY: z.coerce.number().int().min(0).optional(),
    // The SPA's public origin. The password-reset link is built on it, so a wrong value here sends
    // people somewhere that cannot complete the reset. No trailing slash; https in production.
    // (Re-introduced for SCRUM-22; the invite-link flow that first added it was replaced.)
    APP_BASE_URL: z
      .url()
      .default('http://localhost:5173')
      .transform((value) => value.replace(/\/+$/, '')),
    // How outgoing mail is delivered. `console` sends nothing and writes the message to the log,
    // which is the right default for local development and the only sane one for tests.
    MAIL_PROVIDER: z.enum(['console', 'resend', 'brevo']).default('console'),
    // API key for that provider. Unused, and left unset, when MAIL_PROVIDER is `console`.
    MAIL_API_KEY: z.string().default(''),
    // The From address, which the provider must have verified. `Name <address>` is accepted.
    MAIL_FROM: z.string().default('SafeDrop <no-reply@safedrop.local>'),
    // How long a password-reset link stays usable (SCRUM-22 asks for ten minutes).
    PASSWORD_RESET_TTL: duration.default('10m'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production: cookies are only sent over HTTPS (SR-4, SR-5)',
      });
    }
    if (value.NODE_ENV === 'production' && value.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'must list the SPA origin(s) in production (SR-14)',
      });
    }
    if (value.NODE_ENV === 'production' && !value.APP_BASE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_BASE_URL'],
        message:
          "must be the SPA's public https:// URL in production: it is the base of reset links",
      });
    }
    if (value.MAIL_PROVIDER !== 'console' && value.MAIL_API_KEY.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_API_KEY'],
        message: `is required when MAIL_PROVIDER is "${value.MAIL_PROVIDER}"`,
      });
    }
    if (value.MAIL_PROVIDER !== 'console' && !value.MAIL_FROM.includes('@')) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_FROM'],
        message: 'must be an email address the provider has verified',
      });
    }
    for (const origin of value.CORS_ORIGINS) {
      if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: `"${origin}" is not an origin (scheme://host[:port], no path)`,
        });
      }
    }
  });

/**
 * Validate a raw environment object. Throws a readable error listing every problem so a
 * misconfigured deploy fails at boot instead of at the first request.
 * @param {NodeJS.ProcessEnv} source
 */
export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\nSee .env.example.`);
  }
  const data = result.data;
  return Object.freeze({
    ...data,
    isProduction: data.NODE_ENV === 'production',
    isTest: data.NODE_ENV === 'test',
  });
}

export const env = loadEnv();
