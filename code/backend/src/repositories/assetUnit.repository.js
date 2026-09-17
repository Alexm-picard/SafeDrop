// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped AssetUnit persistence and the status aggregation behind the dashboard (SDD §2.4, SCRUM-103)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import mongoose from 'mongoose';
import { AssetUnit } from '../models/AssetUnit.js';
import { UNIT_STATUS_LIST } from '../utils/constants.js';

export async function create(orgId, { assetId, tag, serial, condition, status }, { session } = {}) {
  const [doc] = await AssetUnit.create([{ orgId, assetId, tag, serial, condition, status }], {
    session,
  });
  return doc;
}

export async function findById(orgId, unitId, { session } = {}) {
  return AssetUnit.findOne({ _id: unitId, orgId }).session(session ?? null);
}

export async function listByAsset(orgId, assetId) {
  return AssetUnit.find({ orgId, assetId }).sort({ tag: 1 });
}

export async function updateStatus(orgId, unitId, status, { session } = {}) {
  return AssetUnit.findOneAndUpdate(
    { _id: unitId, orgId },
    { $set: { status } },
    { returnDocument: 'after', runValidators: true, session },
  );
}

/**
 * Counts per status for one tenant, always returning every status key (zero when absent).
 * @returns {Promise<Record<string, number>>}
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
