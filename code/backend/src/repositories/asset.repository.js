// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped Asset persistence (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { Asset } from '../models/Asset.js';

export async function create(orgId, { name, category, description, imageUrl }, { session } = {}) {
  const [doc] = await Asset.create([{ orgId, name, category, description, imageUrl }], { session });
  return doc;
}

export async function findById(orgId, assetId, { session } = {}) {
  return Asset.findOne({ _id: assetId, orgId }).session(session ?? null);
}

export async function list(orgId, { includeRetired = false, category, page = 1, limit = 50 } = {}) {
  const filter = { orgId };
  if (!includeRetired) {
    filter.retiredAt = null;
  }
  if (category) {
    filter.category = category;
  }
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Asset.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    Asset.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

export async function update(orgId, assetId, patch, { session } = {}) {
  return Asset.findOneAndUpdate(
    { _id: assetId, orgId },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  );
}

export async function retire(orgId, assetId, { session } = {}) {
  return Asset.findOneAndUpdate(
    { _id: assetId, orgId, retiredAt: null },
    { $set: { retiredAt: new Date() } },
    { returnDocument: 'after', session },
  );
}
