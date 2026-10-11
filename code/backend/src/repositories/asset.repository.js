// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped Asset persistence (SDD §2.4); case-insensitive category lookup for alternatives (SCRUM-184); word-scored candidate search for AI search (SCRUM-243)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Header restored for SCRUM-216 (removed by mistake in 0ce2729).

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
 * Exports: `create`, `findById`, `list`, `listRestrictedTo`, `search`, `update`, `retire`.
 */
import mongoose from 'mongoose';
import { Asset } from '../models/Asset.js';

/**
 * Insert one asset into the caller's organisation.
 *
 * Uses the array form of `create()` because that is the only form that accepts a session, and the
 * single document is destructured back out.
 * @param {string} orgId tenant id, from the verified token
 * @param {{ name: string, category: string, description?: string, imageUrl?: string, allowedGroupIds?: string[] }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document>} the created asset
 */
export async function create(
  orgId,
  { name, category, description, imageUrl, approvalMode, allowedGroupIds },
  { session } = {},
) {
  // An omitted approvalMode/allowedGroupIds is undefined, which Mongoose replaces with the schema
  // default (INHERIT / [] respectively).
  const [doc] = await Asset.create(
    [{ orgId, name, category, description, imageUrl, approvalMode, allowedGroupIds }],
    { session },
  );
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
 * Fetch several assets by id in one query, scoped to the tenant.
 *
 * Backs the request list's summaries, so a page of 25 requests costs one asset lookup rather than 25.
 * Ids that do not resolve are simply absent from the result.
 * @param {string} orgId
 * @param {unknown[]} assetIds may contain duplicates; they are de-duplicated here
 * @returns {Promise<import('mongoose').Document[]>}
 */
export async function findByIds(orgId, assetIds) {
  const unique = [...new Set(assetIds.map(String))];
  if (unique.length === 0) {
    return [];
  }
  // `sanitizeFilter` is on globally and neutralises operators it did not build; this one is ours.
  return Asset.find({ orgId, _id: mongoose.trusted({ $in: unique }) });
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
 * The tenant's assets in exactly `category`, ignoring case, sorted by name (SCRUM-184).
 *
 * The first place to look for a substitute: an unavailable camera is most likely replaced by another
 * camera. Case-insensitive because categories are free text typed per asset, so "Camera" and "camera"
 * are the same shelf to a member. Anchored and escaped, so it is an exact match and never a pattern.
 * Retired assets are left out, as in `search()`.
 * @param {string} orgId
 * @param {string} category
 * @param {{ limit?: number }} [options]
 * @returns {Promise<import('mongoose').Document[]>}
 */
export async function listByCategory(orgId, category, { limit = 50 } = {}) {
  const pattern = new RegExp(`^${escapeRegExp(category)}$`, 'i');
  return Asset.find({ orgId, retiredAt: null, category: pattern }).sort({ name: 1 }).limit(limit);
}

/**
 * Find the tenant's assets whose name, description or category contains `text`, ignoring case.
 *
 * The plain catalogue search behind SCRUM-103: what a member gets when AI is off, and the fallback
 * when the model's answer cannot be used. Retired assets are left out, the same rule `list()`
 * applies by default (SCRUM-145): a soft-deleted asset cannot be borrowed, so it is not a result.
 *
 * Capped at `limit`, applied after the sort so the cut is always the first names rather than whatever
 * Mongo returned first. Without it a one-letter query loads and returns the whole catalogue (SCRUM-146).
 * @param {string} orgId
 * @param {string} text what the member typed
 * @param {{ limit?: number }} [options]
 * @returns {Promise<import('mongoose').Document[]>} sorted by name, at most `limit` long
 */
export async function search(orgId, text, { limit = 50 } = {}) {
  // Escaped so the text is matched literally: `.*` must not match everything, and a pattern such as
  // `(a+)+$` must never reach the database as a backtracking regex (ReDoS).
  const pattern = new RegExp(escapeRegExp(text), 'i');
  return Asset.find({
    orgId,
    retiredAt: null,
    $or: [{ name: pattern }, { description: pattern }, { category: pattern }],
  })
    .sort({ name: 1 })
    .limit(limit);
}

/** The fields a word may match in, the same three `search()` looks at. */
const WORD_FIELDS = ['name', 'description', 'category'];

/**
 * The tenant's assets that contain any of `words`, best first: by how many of the words each one
 * contains, then by name (SCRUM-243).
 *
 * The candidate pick for AI search. `search()` matches the whole query as one phrase, which a sentence
 * such as "something to record an interview" almost never does, so before this the model was sent the
 * catalogue in name order and anything past the hundredth name never reached it. Matching single words
 * ("record" in "Zoom H5 Recorder", "interview" in its description) puts the likely items first; the
 * model still decides which actually fit.
 *
 * Scored in the database, so only the best `limit` come back however large the catalogue is. Each word
 * is escaped, as in `search()`, so a word is always matched literally. Retired assets are left out
 * (SCRUM-145). The results are hydrated into documents, so callers get the same shape as from `find`.
 * @param {string} orgId
 * @param {string[]} words already lower-cased and reduced by the caller; an empty list matches nothing
 * @param {{ limit?: number }} [options]
 * @returns {Promise<import('mongoose').Document[]>}
 */
export async function searchAnyWord(orgId, words, { limit = 50 } = {}) {
  if (words.length === 0) {
    return [];
  }
  const escaped = words.map(escapeRegExp);
  const contains = (word) => ({
    $or: WORD_FIELDS.map((field) => ({
      $regexMatch: { input: { $ifNull: [`$${field}`, ''] }, regex: word, options: 'i' },
    })),
  });
  const rows = await Asset.aggregate([
    {
      $match: {
        // Aggregation does not cast like `find`, so the tenant id is converted here.
        orgId: new mongoose.Types.ObjectId(String(orgId)),
        retiredAt: null,
        $or: escaped.flatMap((word) =>
          WORD_FIELDS.map((field) => ({ [field]: new RegExp(word, 'i') })),
        ),
      },
    },
    {
      $addFields: {
        wordScore: { $add: escaped.map((word) => ({ $cond: [contains(word), 1, 0] })) },
      },
    },
    { $sort: { wordScore: -1, name: 1 } },
    { $limit: limit },
    { $project: { wordScore: 0 } },
  ]);
  return rows.map((row) => Asset.hydrate(row));
}

/**
 * Backslash every regex metacharacter so `text` matches only itself.
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The tenant's in-circulation assets that list `groupId` in their `allowedGroupIds` (SCRUM-204), by
 * name, with just the fields the group's page needs. Retired assets are left out: nobody can request
 * them whatever their restriction says. Matching an array field against one value needs no query
 * operator, so `sanitizeFilter` leaves it alone.
 * @param {string} orgId
 * @param {string} groupId
 * @returns {Promise<{ _id: import('mongoose').Types.ObjectId, name: string, allowedGroupIds: import('mongoose').Types.ObjectId[] }[]>}
 */
export async function listRestrictedTo(orgId, groupId) {
  return Asset.find(
    { orgId, retiredAt: null, allowedGroupIds: groupId },
    { name: 1, allowedGroupIds: 1 },
  )
    .sort({ name: 1 })
    .lean();
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
