// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: admin dashboard summary aggregated from AssetUnit.status (SCRUM-103)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The admin dashboard summary.
 *
 * A thin aggregation over the unit status counts — the one service in this layer that is fully
 * implemented in Sprint 1, because it reads and nothing more.
 */
import * as assetUnitRepo from '../repositories/assetUnit.repository.js';
import { UNIT_STATUS } from '../utils/constants.js';

/**
 * Count the organisation's units by status for the dashboard (`GET /api/dashboard/summary`).
 *
 * `totalAssets` deliberately excludes retired units: it answers "how much can this organisation lend
 * out?", and a retired item is gone from that pool even though its row remains for history. The
 * retired count is returned separately so the number is visible rather than merely absent.
 * @param {string} orgId
 * @returns {Promise<{ totalAssets: number, checkedOut: number, available: number, held: number, retired: number }>}
 */
export async function summary(orgId) {
  const counts = await assetUnitRepo.countByStatus(orgId);
  const available = counts[UNIT_STATUS.AVAILABLE];
  const held = counts[UNIT_STATUS.HELD];
  const checkedOut = counts[UNIT_STATUS.OUT];
  const retired = counts[UNIT_STATUS.RETIRED];
  return {
    totalAssets: available + held + checkedOut,
    checkedOut,
    available,
    held,
    retired,
  };
}
