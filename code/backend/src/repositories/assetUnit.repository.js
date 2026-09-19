// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped AssetUnit persistence and the status aggregation behind the dashboard (SDD §2.4, SCRUM-103)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Data access for the `assetunits` collection (the individual physical items).
 *
 * Same contract as the other repositories: `orgId` first, folded into every filter, optional
 * `{ session }` for transactional callers.
 *
 * Exports: `create`, `findById`, `listByAsset`, `updateStatus`, `countByStatus`.
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
 * Move one unit to a new lifecycle status (AVAILABLE, HELD, OUT, RETIRED).
 *
 * The write is unconditional on the current status — the checkout service decides whether a
 * transition is legal before calling, and drives the conditional part through the request's own
 * state.
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
