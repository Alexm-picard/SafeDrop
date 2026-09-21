// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: append-only audit repository: only append() and query() exist (SDD §2.5, SR-8)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.
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
 *
 * `targets` is the one filter that is not a single value: it takes groups of
 * `{ type, ids }` and matches an event that belongs to **any** of them. One thing in the world is
 * usually several rows here — an asset's story is told partly against the asset, partly against each
 * of its units, and partly against the requests made for them (SCRUM-29) — so a caller that needs
 * the whole story needs one query over all three rather than three queries it then has to merge and
 * re-sort. Every id in it must already have been resolved inside this tenant by the caller; this
 * function does not check where they came from, and `orgId` in the filter is what stops a stray id
 * from another organisation matching anything.
 * @param {string} orgId
 * @param {{ targetType?: string, targetId?: string, actorId?: string, action?: string, from?: Date, to?: Date, targets?: Array<{ type: string, ids: unknown[] }>, page?: number, limit?: number }} [filters]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function query(
  orgId,
  { targetType, targetId, actorId, action, from, to, targets, page = 1, limit = 50 } = {},
) {
  const filter = { orgId };
  if (targets) {
    const groups = targets.filter((group) => group.ids.length > 0);
    if (groups.length === 0) {
      // Nothing to match. Returning early rather than building `$or: []`, which MongoDB rejects
      // outright — an asset with no units and no requests is an ordinary empty history, not an error.
      return { items: [], total: 0, page, limit };
    }
    filter.$or = groups.map((group) => ({
      targetType: group.type,
      // Ours, not the client's: `sanitizeFilter` would otherwise rewrite `$in` into an equality
      // test against the literal object and the query would silently match nothing.
      targetId: mongoose.trusted({ $in: group.ids }),
    }));
  }
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
