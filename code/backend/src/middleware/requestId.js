// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: per-request UUID for log/audit correlation (chain step 1)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Always server-generated; an incoming X-Request-Id is untrusted and ignored. */
export function requestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
}
