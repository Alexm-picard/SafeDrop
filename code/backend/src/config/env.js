// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Zod schema for every environment variable; fail-fast on missing/invalid values (SR-11)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
    // Number of reverse-proxy hops to trust for req.ip (Render: 1). Default: 1 in production, 0 otherwise.
    TRUST_PROXY: z.coerce.number().int().min(0).optional(),
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
