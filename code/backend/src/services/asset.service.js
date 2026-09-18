// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: asset catalogue service stubs with the acceptance criteria each must satisfy
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Asset and unit management — Sprint 1 stubs.
 *
 * The routes, permissions and validation for `/api/assets` are in place and tested; the behaviour
 * behind them belongs to later tickets. Each function below records what its ticket must do, so the
 * obligations agreed during design (audit events, tenant scoping, conflict handling) are not
 * re-derived when someone picks the ticket up.
 *
 * Every handler will follow the same shape: resolve by (orgId, id) → 404 if absent, then write the
 * change and its audit event inside one `withTransaction()`.
 */
import { NotImplementedError } from '../utils/errors.js';

/**
 * List the asset catalogue (`GET /api/assets`) — not implemented yet.
 *
 * TODO(SCRUM-assets-list): paginated; retired assets hidden unless `?includeRetired=true`.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function list(_orgId, _query) {
  throw new NotImplementedError('SCRUM-assets-list', 'Asset listing is not implemented yet');
}

/**
 * Read one asset with its units (`GET /api/assets/:id`) — not implemented yet.
 *
 * TODO(SCRUM-assets-read): an id belonging to another organisation must answer 404, never 403.
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function get(_orgId, _assetId) {
  throw new NotImplementedError('SCRUM-assets-read', 'Reading an asset is not implemented yet');
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
