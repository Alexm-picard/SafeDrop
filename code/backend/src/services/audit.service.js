// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: audit write helper used inside service transactions (OD-2) and the paginated read for ORG_ADMIN
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The audit trail's write path, and the (not yet implemented) read path.
 *
 * Every service that changes state calls `record()` as part of the same transaction as the change
 * itself. That coupling is the whole design (SDD §2.5, §6.6): an action and the evidence of it commit
 * together or not at all, so the trail cannot end up describing something that was rolled back, nor
 * miss something that happened.
 *
 * Exports: `record(orgId, event, options)`, `list(orgId, filters)` (stub).
 */
import * as auditRepo from '../repositories/auditEvent.repository.js';
import { NotImplementedError } from '../utils/errors.js';

/**
 * Append one audit event for a state change.
 *
 * Must be called with the same `session` as the change it describes — passing no session, or a
 * different one, breaks the guarantee that the two commit together.
 *
 * The actor's role is stored alongside their id, so the trail records the authority someone acted
 * with at the time, which a later role change cannot rewrite. `before`/`after` default to null so an
 * event that has no meaningful pair (a creation, a login) stores an explicit absence rather than
 * `undefined`.
 * @param {string} orgId
 * @param {{ actor: { userId: string, role: string }, action: string, targetType: string, targetId: unknown, before?: unknown, after?: unknown, requestId?: string }} event
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<object>} the stored audit document
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
 * Read the audit trail (`GET /api/audit`) — not implemented yet.
 *
 * TODO(SCRUM-AUDIT-LOG): implement the filter and pagination contract on top of
 * `auditRepo.query()`. Acceptance criterion: an ORG_ADMIN can page through every event of their own
 * organisation, newest first, and never sees an event from another one.
 * @param {string} _orgId
 * @param {object} _filters
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function list(_orgId, _filters) {
  throw new NotImplementedError('SCRUM-audit-log', 'Audit log listing is not implemented yet');
}
