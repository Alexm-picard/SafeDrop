// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped Asset persistence (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Data access for the `assets` collection (the catalogue entries).
 *
 * Every function takes `orgId` first and folds it into the query filter, so a document belonging to
 * another tenant is simply never matched. That is the tenant boundary in practice (SR-2): the service
 * layer turns a `null` result into a 404 rather than a 403, because confirming that an id exists
 * elsewhere would itself leak across the boundary.
 *
 * Each function also accepts an optional `{ session }` so a caller can run it inside a transaction
 * together with its audit event (OD-2).
 *
 * Exports: `create`, `findById`, `list`, `update`, `retire`.
 */
import { Asset } from '../models/Asset.js';

/**
 * Insert one asset into the caller's organisation.
 *
 * Uses the array form of `create()` because that is the only form that accepts a session, and the
 * single document is destructured back out.
 * @param {string} orgId tenant id, from the verified token
 * @param {{ name: string, category: string, description?: string, imageUrl?: string }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document>} the created asset
 */
export async function create(orgId, { name, category, description, imageUrl }, { session } = {}) {
  const [doc] = await Asset.create([{ orgId, name, category, description, imageUrl }], { session });
  return doc;
}

/**
 * Fetch one asset by id, scoped to the tenant.
 * @param {string} orgId
 * @param {string} assetId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>} null when absent *or* owned by another tenant
 */
export async function findById(orgId, assetId, { session } = {}) {
  return Asset.findOne({ _id: assetId, orgId }).session(session ?? null);
}

/**
 * List assets for the catalogue, paginated and sorted by name.
 *
 * Retired assets are excluded unless `includeRetired` is set, since retirement is a soft delete and
 * the catalogue should show what can actually be borrowed. The page of items and the total count
 * are fetched concurrently so pagination costs one round trip rather than two.
 * @param {string} orgId
 * @param {{ includeRetired?: boolean, category?: string, page?: number, limit?: number }} [query]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
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

/**
 * Apply a partial update to one asset and return the updated document.
 *
 * `runValidators` is on so schema rules (lengths, required fields) still apply to an update path,
 * which Mongoose does not do by default.
 * @param {string} orgId
 * @param {string} assetId
 * @param {Record<string, unknown>} patch fields to `$set`; the caller has already validated them
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>} null when no asset matched
 */
export async function update(orgId, assetId, patch, { session } = {}) {
  return Asset.findOneAndUpdate(
    { _id: assetId, orgId },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  );
}

/**
 * Soft-delete an asset by stamping `retiredAt`.
 *
 * The filter requires `retiredAt: null`, so retiring twice returns `null` instead of silently
 * moving the retirement date — the second caller learns it lost the race.
 * @param {string} orgId
 * @param {string} assetId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>} null when absent, foreign, or already retired
 */
export async function retire(orgId, assetId, { session } = {}) {
  return Asset.findOneAndUpdate(
    { _id: assetId, orgId, retiredAt: null },
    { $set: { retiredAt: new Date() } },
    { returnDocument: 'after', session },
  );
}
