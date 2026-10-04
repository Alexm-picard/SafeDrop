// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code)
// AI-Assisted Areas: backfills the pickup grace period (SCRUM-205) on existing organisations
// Human Contributions: design (48-hour default) from the SCRUM-205 story; pending team review
// Notes: Data-only migration, no indexes. Idempotent: it only touches documents missing the field.

/**
 * Migration: give every existing organisation an explicit pickup grace period (SCRUM-205).
 *
 * Organisations get `pickupSettings.graceHours = 48`, the default the story settled on. The code
 * already reads a missing value as 48 (the Mongoose default and `DEFAULT_PICKUP_GRACE_HOURS`), so
 * this is about the stored data saying what it means, as with the approval-settings migration.
 *
 * Only documents *missing* the field are touched, so running it twice, or after an admin has already
 * chosen a value, never overwrites a real choice.
 */

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db
    .collection('organizations')
    .updateMany(
      { 'pickupSettings.graceHours': { $exists: false } },
      { $set: { 'pickupSettings.graceHours': 48 } },
    );
};

/**
 * Remove the field. Any value an admin chose since `up` is lost; the code being rolled back to never
 * expires approvals, so nothing reads it.
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db
    .collection('organizations')
    .updateMany({ pickupSettings: { $exists: true } }, { $unset: { pickupSettings: '' } });
};
