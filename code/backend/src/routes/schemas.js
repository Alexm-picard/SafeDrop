// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: reusable Zod fragments for params/query/body validation (OD-6: Zod for the whole team)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { z } from 'zod';
import { slugify } from '../utils/slug.js';
import {
  OBJECT_ID_PATTERN,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  SLUG_PATTERN,
} from '../utils/constants.js';

export const objectId = z.string().regex(OBJECT_ID_PATTERN, 'must be a 24-character hex id');
export const idParams = z.object({ id: objectId });

export const email = z.string().trim().toLowerCase().email().max(254);
export const personName = z.string().trim().min(1).max(120);
export const orgName = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .refine((value) => slugify(value).length > 0, {
    message: 'must contain at least one letter or digit',
  });
export const orgSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, 'must be a URL-safe slug');

export const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES, {
    message: `must be at most ${PASSWORD_MAX_BYTES} bytes`,
  });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Bodies for routes that take no input (logout, retire, cancel...): only an empty object is valid. */
export const emptyBody = z.object({});
