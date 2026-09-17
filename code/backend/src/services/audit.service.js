// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: audit write helper used inside service transactions (OD-2) and the paginated read for ORG_ADMIN
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import * as auditRepo from '../repositories/auditEvent.repository.js';
import { NotImplementedError } from '../utils/errors.js';

/**
 * Record one state change. Must be called with the same `session` as the change itself so the
 * audit row commits or rolls back together with it (SDD §2.5, §6.6).
 * @param {string} orgId
 * @param {{ actor: { userId: string, role: string }, action: string, targetType: string, targetId: unknown, before?: unknown, after?: unknown, requestId?: string }} event
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 */
export async function record(
  orgId,
  { actor, action, targetType, targetId, before, after, requestId },
  { session } = {},
) {
  return auditRepo.append(
    orgId,
    {
      actorId: actor.userId,
      actorRole: actor.role,
      action,
      targetType,
      targetId,
      before: before ?? null,
      after: after ?? null,
      requestId: requestId ?? null,
    },
    { session },
  );
}

/**
 * GET /api/audit — paginated, newest first, ORG_ADMIN only.
 * TODO(SCRUM-AUDIT-LOG): implement filters + pagination contract; acceptance criterion: an admin can
 * page through every event of their org and never sees another org's events.
 */
export async function list(_orgId, _filters) {
  throw new NotImplementedError('SCRUM-audit-log', 'Audit log listing is not implemented yet');
}
