// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped AssetUnit persistence and the status aggregation behind the dashboard (SDD §2.4, SCRUM-102)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Data access for the `assetunits` collection (the individual physical items).
 *
 * Same contract as the other repositories: `orgId` first, folded into every filter, optional
 * `{ session }` for transactional callers.
 *
 * Exports: `create`, `findById`, `listByAsset`, `countByAssetInStatuses`, `updateStatus`,
 * `updateStatusIfCurrent`, `updateStatusAndCondition`, `countByStatus`.
 */
import mongoose from 'mongoose';
import { AssetUnit } from '../models/AssetUnit.js';
import { UNIT_STATUS_LIST } from '../utils/constants.js';

/**
 * Insert one unit under an asset.
 *
 * The caller is responsible for having checked that `assetId` belongs to the same organisation;
 * this function only guarantees the new unit is stamped with the caller's tenant.
 * @param {string} orgId
 * @param {{ assetId: string, tag: string, serial?: string, condition?: string, status?: string }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document>}
 */
export async function create(orgId, { assetId, tag, serial, condition, status }, { session } = {}) {
  const [doc] = await AssetUnit.create([{ orgId, assetId, tag, serial, condition, status }], {
    session,
  });
  return doc;
}

/**
 * Fetch one unit by id, scoped to the tenant.
 * @param {string} orgId
 * @param {string} unitId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findById(orgId, unitId, { session } = {}) {
  return AssetUnit.findOne({ _id: unitId, orgId }).session(session ?? null);
}

/**
 * List every unit of one asset, ordered by tag.
 *
 * Not paginated: this backs the asset detail view, where the number of units is small and a stable
 * tag order is what makes the list readable.
 * @param {string} orgId
 * @param {string} assetId
 * @returns {Promise<object[]>}
 */
export async function listByAsset(orgId, assetId) {
  return AssetUnit.find({ orgId, assetId }).sort({ tag: 1 });
}

/**
 * Count one asset's units that are currently in any of `statuses`.
 *
 * Exists for the retire guard (SCRUM-134), which has to answer "is anybody holding one of these?"
 * without pulling every unit across the wire. It takes a `session` — unlike `listByAsset`, which
 * backs a plain read — because that answer is only trustworthy if it is read inside the same
 * transaction that then writes the retirement: without it, a checkout committing between the count
 * and the write would be missed, and the asset would retire out from under a borrower.
 *
 * The `$in` is wrapped in `mongoose.trusted()` because `sanitizeFilter` is on globally: it strips
 * query operators out of filter *values* to defeat injection, so operators the server builds itself
 * have to be marked as ours. Without it the operator is treated as a literal status to match, which
 * fails to cast and surfaces as a puzzling 400 instead of a count.
 * @param {string} orgId
 * @param {string} assetId
 * @param {string[]} statuses statuses from UNIT_STATUS
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<number>}
 */
export async function countByAssetInStatuses(orgId, assetId, statuses, { session } = {}) {
  return AssetUnit.countDocuments({
    orgId,
    assetId,
    status: mongoose.trusted({ $in: statuses }),
  }).session(session ?? null);
}

/**
 * Move one unit to a new lifecycle status (AVAILABLE, HELD, OUT, RETIRED, REQUESTED).
 *
 * The write is unconditional on the current status — the checkout service decides whether a
 * transition is legal before calling, and drives the conditional part through the request's own
 * state (or, for the AVAILABLE -> REQUESTED reservation specifically, through
 * `updateStatusIfCurrent` below).
 * @param {string} orgId
 * @param {string} unitId
 * @param {string} status one of UNIT_STATUS
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function updateStatus(orgId, unitId, status, { session } = {}) {
  return AssetUnit.findOneAndUpdate(
    { _id: unitId, orgId },
    { $set: { status } },
    { returnDocument: 'after', runValidators: true, session },
  );
}

/**
 * Move a unit from one status to another, but only if it is still in `from` at the moment of the
 * write.
 *
 * The compare-and-set `submit()` needs: reading AVAILABLE and then writing REQUESTED unconditionally
 * would leave the exact race the ticket asks to close open — two submits could both read AVAILABLE
 * before either writes. This makes the second one lose, atomically, at the database, the same way
 * `checkoutRequestRepo.transition()`'s `expectedState` makes a request's own state changes safe.
 * @param {string} orgId
 * @param {string} unitId
 * @param {{ from: string, to: string }} change
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>} the updated unit, or null if it was no longer `from`
 */
export async function updateStatusIfCurrent(orgId, unitId, { from, to }, { session } = {}) {
  return AssetUnit.findOneAndUpdate(
    { _id: unitId, orgId, status: from },
    { $set: { status: to } },
    { returnDocument: 'after', runValidators: true, session },
  );
}

/**
 * Count units per status for one tenant — the raw numbers behind the admin dashboard.
 *
 * Aggregation returns only the statuses that actually occur, so the result is merged onto a
 * zero-filled map of every status: the dashboard then renders a stable set of tiles instead of
 * making a missing key mean zero. `orgId` is cast to an ObjectId explicitly because an aggregation
 * `$match` gets no schema casting, and a string would match nothing.
 * @param {string} orgId
 * @returns {Promise<Record<string, number>>} every status key, zero when absent
 */
export async function countByStatus(orgId) {
  const rows = await AssetUnit.aggregate([
    { $match: { orgId: new mongoose.Types.ObjectId(String(orgId)) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(UNIT_STATUS_LIST.map((status) => [status, 0]));
  for (const row of rows) {
    counts[row._id] = row.count;
  }
  return counts;
}

/**
 * Move a unit to a new status and, optionally, record a condition change in the same write.
 *
 * Used by the return handoff: the unit's status always changes (OUT -> AVAILABLE), and the condition
 * changes only when the person returning it reports one.
 * @param {string} orgId
 * @param {string} unitId
 * @param {{ status: string, condition?: string }} changes
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function updateStatusAndCondition(
  orgId,
  unitId,
  { status, condition },
  { session } = {},
) {
  const set = { status };
  if (condition) {
    set.condition = condition;
  }
  return AssetUnit.findOneAndUpdate(
    { _id: unitId, orgId },
    { $set: set },
    { returnDocument: 'after', runValidators: true, session },
  );
}
