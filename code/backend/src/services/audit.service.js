// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: audit write helper used inside service transactions (OD-2) and the paginated read for ORG_ADMIN
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The audit trail's write path and its read path.
 *
 * Every service that changes state calls `record()` as part of the same transaction as the change
 * itself. That coupling is the whole design (SDD §2.5, §6.6): an action and the evidence of it commit
 * together or not at all, so the trail cannot end up describing something that was rolled back, nor
 * miss something that happened.
 *
 * The read path is `list()`, and the asymmetry between the two is deliberate: there is a function to
 * append and a function to read, and none to change or remove. That holds all the way down —
 * `auditEvent.repository.js` exposes only those two, and `models/AuditEvent.js` throws on every
 * mutating Mongoose operation (SR-8).
 *
 * Exports: `record(orgId, event, options)`, `list(orgId, filters)`.
 */
import * as auditRepo from '../repositories/auditEvent.repository.js';

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
 * Read the audit trail (`GET /api/audit`, SCRUM-46).
 *
 * A read-only projection over `auditRepo.query()`, newest first and paginated. The filters are
 * forwarded one by one rather than spread, so the set this service supports is visible here: a field
 * added to the route schema does not silently become a query filter without someone deciding it
 * should be.
 *
 * `orgId` is the caller's own, supplied by `scopeTenant` from the verified token and never from the
 * request — which is what makes "never sees another organisation's events" structural rather than a
 * check that could be forgotten (SR-2). Who may call this at all is settled upstream by the route's
 * `audit:read` permission, held only by ORG_ADMIN, so there is deliberately no role logic here.
 *
 * Note that `from`/`to` have already been coerced to `Date` by the route schema, and the repository
 * marks the resulting range operators as trusted — `sanitizeFilter` would otherwise strip them.
 * @param {string} orgId the caller's organisation, from the access token
 * @param {{ action?: string, targetType?: string, targetId?: string, actorId?: string, from?: Date, to?: Date, page?: number, limit?: number }} [filters] validated by `auditQuery`
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function list(orgId, filters = {}) {
  const { action, targetType, targetId, actorId, from, to, page, limit } = filters;
  return auditRepo.query(orgId, {
    action,
    targetType,
    targetId,
    actorId,
    from,
    to,
    page,
    limit,
  });
}
