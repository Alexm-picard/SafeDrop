// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-150 ticket)
// AI-Assisted Areas: converts the single requiredGroupId (SCRUM-149) on assets into the allowedGroupIds list (SCRUM-150)
// Human Contributions: any-of-several-groups design decided by Alex Picard (2026-10-03); pending team review
// Notes: Data-only migration, no indexes. Idempotent: it only touches assets still carrying requiredGroupId or missing allowedGroupIds.

/**
 * Migration: replace each asset's `requiredGroupId` with `allowedGroupIds` (SCRUM-150).
 *
 * SCRUM-149 restricted an asset to exactly one group. SCRUM-150 widens that to a list, where being an
 * active member of any one group is enough, so an asset can accept a narrow certification ("Forklift
 * Certified") and a broad one ("Heavy Machinery Certified") alike.
 *
 * - An asset restricted to a group keeps exactly that restriction: `[requiredGroupId]`.
 * - An unrestricted asset (`requiredGroupId: null`, or no field at all) gets `[]`, which means the
 *   same thing — open to the whole organisation.
 *
 * Nobody's access changes. Running it twice is harmless: the first step only matches assets that still
 * carry `requiredGroupId`, and the second only those still missing `allowedGroupIds`.
 */

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const assets = db.collection('assets');
  // An update pipeline, so each asset's own requiredGroupId can be read into its new list.
  await assets.updateMany({ requiredGroupId: { $exists: true, $ne: null } }, [
    { $set: { allowedGroupIds: ['$requiredGroupId'] } },
    { $unset: 'requiredGroupId' },
  ]);
  await assets.updateMany({ requiredGroupId: null }, { $unset: { requiredGroupId: '' } });
  await assets.updateMany(
    { allowedGroupIds: { $exists: false } },
    { $set: { allowedGroupIds: [] } },
  );
};

/**
 * Back to one group per asset. **Lossy:** an asset restricted to several groups keeps only the
 * first, so members eligible only through the others lose access until an admin fixes it. That is
 * the closest the old code can express, and it fails closed (no asset becomes open).
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const assets = db.collection('assets');
  await assets.updateMany({ 'allowedGroupIds.0': { $exists: true } }, [
    { $set: { requiredGroupId: { $first: '$allowedGroupIds' } } },
  ]);
  await assets.updateMany(
    { requiredGroupId: { $exists: false } },
    { $set: { requiredGroupId: null } },
  );
  await assets.updateMany({}, { $unset: { allowedGroupIds: '' } });
};
