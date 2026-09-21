// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents; write path added for SCRUM-134)
// AI-Assisted Areas: asset catalogue read path (list + get, SCRUM-115) and write path (create/update/retire/addUnit, SCRUM-134)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Asset and unit management.
 *
 * `list()` and `get()` (SCRUM-115) are the catalogue's read path — the first feature domino, since
 * nothing can be requested, approved or checked out before it can be listed. SCRUM-134 adds the
 * write path behind the admin screens SCRUM-122 delivered.
 *
 * Every write handler has the same shape, the one `checkout.service.js` established: resolve by
 * `(orgId, id)` → 404 if absent → write the change and its audit event inside one
 * `withTransaction()`, passing the session to every repository call. The transaction is the point
 * (SR-9, NFR-2): a state change and the evidence of it commit together or not at all, so the trail
 * can neither describe something that rolled back nor miss something that happened.
 *
 * **Tenant safety here is structural, not a check.** Every repository folds `orgId` into its filter,
 * so an id from another organisation and an id that never existed are indistinguishable — both come
 * back `null`, and both answer 404 rather than 403. A 403 would confirm the record exists somewhere,
 * which is the existence leak SR-2 prohibits.
 *
 * **The audit snapshots record the changed fields, not whole documents.** `update()` stores the old
 * and new values of exactly the keys that were patched, so the trail answers "what changed" rather
 * than leaving a reader to diff two copies of everything.
 */
import { withTransaction } from '../config/db.js';
import * as assetRepo from '../repositories/asset.repository.js';
import * as assetUnitRepo from '../repositories/assetUnit.repository.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE, UNIT_STATUS } from '../utils/constants.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { record as recordAudit } from './audit.service.js';

/**
 * The unit statuses that block retiring the asset they belong to.
 *
 * `OUT` is in someone's hands, `HELD` is promised to someone, and `REQUESTED` has an undecided
 * request sitting on it — retiring the asset out from under any of the three would leave that
 * request or loan with nothing to resolve to. `AVAILABLE` and `RETIRED` units are no obstacle —
 * nobody is relying on them.
 */
const BLOCKING_UNIT_STATUSES = Object.freeze([
  UNIT_STATUS.OUT,
  UNIT_STATUS.HELD,
  UNIT_STATUS.REQUESTED,
]);

/**
 * Is this the duplicate-key error MongoDB raises against a unique index?
 * @param {unknown} err
 * @returns {boolean}
 */
const isDuplicateKey = (err) => Boolean(err) && err.code === 11000;

/**
 * Snapshot just the keys of `patch` as they currently stand on `doc`.
 *
 * The "before" half of an update's audit entry. Reading through `toJSON()` rather than the Mongoose
 * document means the stored values are the same plain shapes the API serialises, so a reader of the
 * trail compares like with like.
 * @param {import('mongoose').Document} doc
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown>}
 */
function snapshotOf(doc, patch) {
  const json = doc.toJSON();
  return Object.fromEntries(Object.keys(patch).map((key) => [key, json[key] ?? null]));
}

/**
 * List the asset catalogue (`GET /api/assets`, SCRUM-115).
 *
 * A thin pass-through to the repository: pagination, the category filter and `includeRetired` are
 * already validated and coerced by the route's `listQuery` schema, and `orgId` is the caller's own
 * from `scopeTenant` — never from the request — so the tenant boundary is structural rather than a
 * check that could be forgotten (SR-2).
 * @param {string} orgId the caller's organisation, from the access token
 * @param {{ page?: number, limit?: number, category?: string, includeRetired?: boolean }} [query]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function list(orgId, query = {}) {
  return assetRepo.list(orgId, query);
}

/**
 * Read one asset with its units (`GET /api/assets/:id`, SCRUM-115).
 *
 * `assetRepo.findById` scopes its lookup by `orgId`, so an id belonging to another organisation is
 * indistinguishable from one that does not exist at all — both come back `null` and both answer 404,
 * never 403. Confirming existence to a caller who cannot see the record would itself leak across the
 * tenant boundary (SR-2).
 * @param {string} orgId the caller's organisation, from the access token
 * @param {string} assetId validated as an object id by the route's `idParams` schema
 * @returns {Promise<object>} the asset's fields plus its `units`
 * @throws {NotFoundError} (404) when absent, retired-or-not, from this or any other organisation
 */
export async function get(orgId, assetId) {
  const asset = await assetRepo.findById(orgId, assetId);
  if (!asset) {
    throw new NotFoundError('Asset not found');
  }
  const units = await assetUnitRepo.listByAsset(orgId, assetId);
  return { ...asset.toJSON(), units };
}

/**
 * Create an asset (`POST /api/assets`, SCRUM-134).
 *
 * `orgId` is the caller's own, from `scopeTenant`, and is stamped on the document by the repository
 * — it is never read from the body, so a request cannot create an asset inside somebody else's
 * organisation (server-assigned ownership, SDD §6.4).
 *
 * The audit entry has an `after` and no `before`, because nothing preceded it. It carries the whole
 * created asset rather than a field list: for a creation, "what changed" is the record itself.
 * @param {string} orgId the caller's organisation, from the access token
 * @param {{ userId: string, role: string }} actor
 * @param {{ name: string, category: string, description?: string, imageUrl?: string|null, requestId?: string }} input
 *   validated `assetBody`, plus the HTTP request id for audit correlation
 * @returns {Promise<object>} the created asset
 */
export async function create(orgId, actor, input = {}) {
  const { name, category, description, imageUrl, requestId } = input;
  return withTransaction(async (session) => {
    const asset = await assetRepo.create(
      orgId,
      { name, category, description, imageUrl },
      { session },
    );
    await recordAudit(
      orgId,
      {
        actor,
        action: AUDIT_ACTION.ASSET_CREATED,
        targetType: AUDIT_TARGET_TYPE.Asset,
        targetId: asset._id,
        after: asset.toJSON(),
        requestId,
      },
      { session },
    );
    return asset.toJSON();
  });
}

/**
 * Apply a partial update to an asset (`PATCH /api/assets/:id`, SCRUM-134).
 *
 * The `before` snapshot is taken inside the transaction, immediately before the write, so the pair
 * stored in the trail is the change this call actually made rather than a diff against whatever the
 * asset looked like when the admin opened the form.
 *
 * Only the keys present in the patch are snapshotted. `assetPatch` is `assetBody.partial()`, so an
 * admin who edits one field produces an entry naming that field — not two copies of the whole
 * document for a reader to compare.
 *
 * An empty patch is not an error: it writes nothing and records nothing, which is the honest answer
 * to "change nothing". `requestId` is stripped first, since it is audit plumbing rather than a field
 * of the asset.
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {string} assetId validated as an object id by the route's `idParams` schema
 * @param {Record<string, unknown>} patch validated `assetPatch`, plus `requestId`
 * @returns {Promise<object>} the updated asset
 * @throws {NotFoundError} (404) absent, or owned by another organisation
 */
export async function update(orgId, actor, assetId, patch = {}) {
  const { requestId, ...fields } = patch;
  return withTransaction(async (session) => {
    const existing = await assetRepo.findById(orgId, assetId, { session });
    if (!existing) {
      throw new NotFoundError('Asset not found');
    }
    if (Object.keys(fields).length === 0) {
      return existing.toJSON();
    }

    const before = snapshotOf(existing, fields);
    const updated = await assetRepo.update(orgId, assetId, fields, { session });
    if (!updated) {
      // Deleted between the read and the write. Nothing to update, and nothing to record.
      throw new NotFoundError('Asset not found');
    }

    await recordAudit(
      orgId,
      {
        actor,
        action: AUDIT_ACTION.ASSET_UPDATED,
        targetType: AUDIT_TARGET_TYPE.Asset,
        targetId: assetId,
        before,
        after: snapshotOf(updated, fields),
        requestId,
      },
      { session },
    );
    return updated.toJSON();
  });
}

/**
 * Retire an asset (`POST /api/assets/:id/retire`, SCRUM-134).
 *
 * A soft delete: the asset keeps its id, its units and its history, and only stops appearing in the
 * catalogue. That is why the route is a POST to `/retire` rather than a DELETE — historical requests
 * still have to resolve to the thing they borrowed.
 *
 * **Refused while any unit is OUT, HELD or REQUESTED.** Retiring an asset somebody is holding, or
 * that has an undecided request on it, would leave that loan or request with nothing to resolve
 * to. The count is read inside the transaction, so a checkout or a submit committing between the
 * check and the write cannot slip past it; the message names the reason because the admin screen
 * shows it verbatim.
 *
 * **Retiring twice is a 409, not a silent success.** The repository's filter requires
 * `retiredAt: null`, so the second caller learns it lost the race rather than quietly moving the
 * retirement date and rewriting when the asset left circulation.
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {string} assetId
 * @param {{ requestId?: string }} [input] the HTTP request id for audit correlation
 * @returns {Promise<object>} the retired asset
 * @throws {NotFoundError} (404) absent, or owned by another organisation
 * @throws {ConflictError} (409) already retired, or a unit is still OUT, HELD or REQUESTED
 */
export async function retire(orgId, actor, assetId, input = {}) {
  const { requestId } = input;
  return withTransaction(async (session) => {
    const existing = await assetRepo.findById(orgId, assetId, { session });
    if (!existing) {
      throw new NotFoundError('Asset not found');
    }
    if (existing.retiredAt) {
      throw new ConflictError('This asset is already retired');
    }

    const blocking = await assetUnitRepo.countByAssetInStatuses(
      orgId,
      assetId,
      BLOCKING_UNIT_STATUSES,
      { session },
    );
    if (blocking > 0) {
      throw new ConflictError(
        'Cannot retire an asset while one of its units is checked out, held, or requested',
      );
    }

    const retired = await assetRepo.retire(orgId, assetId, { session });
    if (!retired) {
      // Another admin retired it between the read and the write.
      throw new ConflictError('This asset is already retired');
    }

    await recordAudit(
      orgId,
      {
        actor,
        action: AUDIT_ACTION.ASSET_RETIRED,
        targetType: AUDIT_TARGET_TYPE.Asset,
        targetId: assetId,
        before: { retiredAt: null },
        after: { retiredAt: retired.toJSON().retiredAt },
        requestId,
      },
      { session },
    );
    return retired.toJSON();
  });
}

/**
 * Add a physical unit to an asset (`POST /api/assets/:id/units`, SCRUM-134).
 *
 * The asset is resolved by `(orgId, id)` first, so a unit can never be attached to another
 * organisation's asset — the repository's own contract says the caller is responsible for that
 * check, and this is it.
 *
 * **A new unit always starts AVAILABLE**, set here rather than taken from the body. `unitBody` does
 * not accept `status` at all, so this is belt and braces: a unit cannot be created already checked
 * out to nobody.
 *
 * **The duplicate tag is caught from the unique index, not a pre-check.** `assetunits.orgId_tag_unique`
 * already enforces it, and reading first to see whether a tag is taken would leave a gap in which
 * another admin could take it. The duplicate-key error is translated here rather than left to the
 * error handler, which answers a generic 409: naming the field is what puts the message under the
 * tag input on the admin screen instead of in a page-level banner.
 *
 * **The audit action is ASSET_UPDATED against an AssetUnit target.** There is no ASSET_UNIT_ADDED in
 * `AUDIT_ACTION`, and adding one is a design change that has to go through the SDD (see the note on
 * that enum), so the closest true statement is used instead: the asset's inventory changed, and
 * `targetType`/`targetId` say which unit it was. Worth revisiting if the trail needs to distinguish
 * adding a unit from editing the asset's own fields.
 * @param {string} orgId
 * @param {{ userId: string, role: string }} actor
 * @param {string} assetId
 * @param {{ tag: string, serial?: string|null, condition?: string, requestId?: string }} input validated `unitBody`
 * @returns {Promise<object>} the created unit
 * @throws {NotFoundError} (404) no such asset in this organisation
 * @throws {ConflictError} (409) the tag is already used in this organisation
 */
export async function addUnit(orgId, actor, assetId, input = {}) {
  const { tag, serial, condition, requestId } = input;
  return withTransaction(async (session) => {
    const asset = await assetRepo.findById(orgId, assetId, { session });
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    let unit;
    try {
      unit = await assetUnitRepo.create(
        orgId,
        { assetId, tag, serial, condition, status: UNIT_STATUS.AVAILABLE },
        { session },
      );
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new ConflictError('A unit with this tag already exists', { field: 'tag' });
      }
      throw err;
    }

    await recordAudit(
      orgId,
      {
        actor,
        action: AUDIT_ACTION.ASSET_UPDATED,
        targetType: AUDIT_TARGET_TYPE.AssetUnit,
        targetId: unit._id,
        after: unit.toJSON(),
        requestId,
      },
      { session },
    );
    return unit.toJSON();
  });
}
