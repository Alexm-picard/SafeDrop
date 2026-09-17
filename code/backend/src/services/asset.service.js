// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: asset catalogue service stubs with the acceptance criteria each must satisfy
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { NotImplementedError } from '../utils/errors.js';

/** GET /api/assets — TODO(SCRUM-assets-list): paginated; retired hidden unless ?includeRetired=true. */
export async function list(_orgId, _query) {
  throw new NotImplementedError('SCRUM-assets-list', 'Asset listing is not implemented yet');
}

/** GET /api/assets/:id — TODO(SCRUM-assets-read): returns asset + its units; other org's id → 404. */
export async function get(_orgId, _assetId) {
  throw new NotImplementedError('SCRUM-assets-read', 'Reading an asset is not implemented yet');
}

/** POST /api/assets — TODO(SCRUM-assets-create): appends ASSET_CREATED in the same transaction. */
export async function create(_orgId, _actor, _input) {
  throw new NotImplementedError('SCRUM-assets-create', 'Creating assets is not implemented yet');
}

/** PATCH /api/assets/:id — TODO(SCRUM-assets-update): appends ASSET_UPDATED with before/after. */
export async function update(_orgId, _actor, _assetId, _patch) {
  throw new NotImplementedError('SCRUM-assets-update', 'Updating assets is not implemented yet');
}

/** POST /api/assets/:id/retire — TODO(SCRUM-assets-retire): refuses while any unit is OUT/HELD; appends ASSET_RETIRED. */
export async function retire(_orgId, _actor, _assetId) {
  throw new NotImplementedError('SCRUM-assets-retire', 'Retiring assets is not implemented yet');
}

/** POST /api/assets/:id/units — TODO(SCRUM-assets-units): tag unique per org (409 on duplicate). */
export async function addUnit(_orgId, _actor, _assetId, _input) {
  throw new NotImplementedError('SCRUM-assets-units', 'Adding units is not implemented yet');
}
