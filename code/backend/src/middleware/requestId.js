// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: per-request UUID for log/audit correlation (chain step 1)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Chain step 1: give every request a unique id for log correlation.
 *
 * The id goes onto `req.id`, into the response headers so a client can quote it in a bug report, and
 * into the logger's child bindings so every line produced while handling the request carries it.
 */
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Attach a fresh UUID to the request and echo it in the response header.
 *
 * The id is always generated here; an incoming `X-Request-Id` is ignored rather than honoured,
 * because a client-chosen id could be repeated across requests or forged to make one caller's
 * activity look like another's in the logs.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
}
