// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: append-only audit repository: only append() and query() exist (SDD §2.5, SR-8)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// There is deliberately no update or delete function here, and no route exposes one. The model
// additionally throws on every mutating Mongoose operation (see models/AuditEvent.js).

/**
 * Data access for the `auditevents` collection — append and read, nothing else (SR-8).
 *
 * The missing functions are the point: there is no update and no delete here, and no route exposes
 * one, so the only way an audit row can change is through code that does not exist. models/AuditEvent.js
 * backs that up by throwing on every mutating Mongoose operation.
 *
 * Exports: `append(orgId, event, options)`, `query(orgId, filters)`.
 */
import mongoose from 'mongoose';
import { AuditEvent } from '../models/AuditEvent.js';

/**
 * Append one audit row. Called by services INSIDE the same transaction as the state change (OD-2),
 * so either both commit or neither does.
 * @param {string} orgId
 * @param {{ actorId: string, actorRole: string, action: string, targetType: string, targetId: string, before?: unknown, after?: unknown, requestId?: string }} event
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 */
export async function append(orgId, event, { session } = {}) {
  const [doc] = await AuditEvent.create(
    [
      {
        orgId,
        actorId: event.actorId,
        actorRole: event.actorRole,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        before: event.before ?? null,
        after: event.after ?? null,
        requestId: event.requestId ?? null,
      },
    ],
    { session },
  );
  return doc;
}

/**
 * Read the audit trail for one tenant, newest first and paginated.
 *
 * Every filter is optional and only applied when present, so the same function serves the full log
 * and a narrow "what happened to this request" view. The sort is `timestamp` then `_id`, which keeps
 * the order stable across pages when several events share a timestamp — without the tiebreak, a row
 * can appear on two pages or on none.
 *
 * The date range is wrapped in `mongoose.trusted()` because `sanitizeFilter` is on globally: it
 * strips query operators out of filter *values* to defeat injection, so operators the server builds
 * itself must be marked as ours.
 * @param {string} orgId
 * @param {{ targetType?: string, targetId?: string, actorId?: string, action?: string, from?: Date, to?: Date, page?: number, limit?: number }} [filters]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function query(
  orgId,
  { targetType, targetId, actorId, action, from, to, page = 1, limit = 50 } = {},
) {
  const filter = { orgId };
  if (targetType) {
    filter.targetType = targetType;
  }
  if (targetId) {
    filter.targetId = targetId;
  }
  if (actorId) {
    filter.actorId = actorId;
  }
  if (action) {
    filter.action = action;
  }
  if (from || to) {
    const range = {};
    if (from) {
      range.$gte = from;
    }
    if (to) {
      range.$lte = to;
    }
    // sanitizeFilter is on globally; operators we build ourselves must be marked trusted.
    filter.timestamp = mongoose.trusted(range);
  }
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    AuditEvent.find(filter).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit),
    AuditEvent.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}
