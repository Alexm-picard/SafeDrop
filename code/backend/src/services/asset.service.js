// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: asset catalogue read path (list + get); create/update/retire/addUnit remain Sprint 1 stubs
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Asset and unit management.
 *
 * The routes, permissions and validation for `/api/assets` are in place and tested. `list()` and
 * `get()` (SCRUM-115) are the catalogue's read path — the first feature domino, since nothing can be
 * requested, approved or checked out before it can be listed. The remaining handlers are still Sprint
 * 1 stubs; each records what its own ticket must do, so the obligations agreed during design (audit
 * events, tenant scoping, conflict handling) are not re-derived when someone picks it up.
 *
 * Every write handler will follow the same shape: resolve by (orgId, id) → 404 if absent, then write
 * the change and its audit event inside one `withTransaction()`.
 */
import * as assetRepo from '../repositories/asset.repository.js';
import * as assetUnitRepo from '../repositories/assetUnit.repository.js';
import { NotFoundError, NotImplementedError } from '../utils/errors.js';

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
 * Create an asset (`POST /api/assets`) — not implemented yet.
 *
 * TODO(SCRUM-assets-create): append ASSET_CREATED in the same transaction as the insert.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function create(_orgId, _actor, _input) {
  throw new NotImplementedError('SCRUM-assets-create', 'Creating assets is not implemented yet');
}

/**
 * Update an asset (`PATCH /api/assets/:id`) — not implemented yet.
 *
 * TODO(SCRUM-assets-update): append ASSET_UPDATED carrying before/after, so the trail shows what
 * changed rather than only that something did.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function update(_orgId, _actor, _assetId, _patch) {
  throw new NotImplementedError('SCRUM-assets-update', 'Updating assets is not implemented yet');
}

/**
 * Retire an asset (`POST /api/assets/:id/retire`) — not implemented yet.
 *
 * TODO(SCRUM-assets-retire): refuse while any unit is OUT or HELD — retiring an asset someone is
 * holding would leave a checked-out item with nothing to return it to — and append ASSET_RETIRED.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function retire(_orgId, _actor, _assetId) {
  throw new NotImplementedError('SCRUM-assets-retire', 'Retiring assets is not implemented yet');
}

/**
 * Add a physical unit to an asset (`POST /api/assets/:id/units`) — not implemented yet.
 *
 * TODO(SCRUM-assets-units): the tag is unique per organisation, so a duplicate is a 409.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function addUnit(_orgId, _actor, _assetId, _input) {
  throw new NotImplementedError('SCRUM-assets-units', 'Adding units is not implemented yet');
}
