// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code)
// AI-Assisted Areas: backfills the configurable-approval fields (SCRUM-148) on existing organisations and assets
// Human Contributions: design (REQUIRED / INHERIT defaults) from the SCRUM-148 story by Orelmis Toribio; pending team review
// Notes: Data-only migration, no indexes. Idempotent: it only touches documents missing the field.

/**
 * Migration: give every existing organisation and asset an explicit approval setting (SCRUM-148).
 *
 * Organisations get `approvalSettings.defaultMode = 'REQUIRED'` and assets get
 * `approvalMode = 'INHERIT'`. Together those reproduce Iteration 1 exactly — every request still waits
 * for an approver — so deploying this changes nobody's behaviour until an Org Admin opts in.
 *
 * The code already treats a missing value as REQUIRED/INHERIT (Mongoose defaults on read, and the
 * policy fails closed), so this is about the stored data saying what it means: an admin query or an
 * export should not have to know that "absent" means "required".
 *
 * Only documents *missing* the field are touched, so running it twice, or after an admin has already
 * changed a setting, never overwrites a real choice.
 */

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db
    .collection('organizations')
    .updateMany(
      { 'approvalSettings.defaultMode': { $exists: false } },
      { $set: { 'approvalSettings.defaultMode': 'REQUIRED' } },
    );
  await db
    .collection('assets')
    .updateMany({ approvalMode: { $exists: false } }, { $set: { approvalMode: 'INHERIT' } });
};

/**
 * Remove both fields. Any setting an admin chose since `up` is lost, and every request goes back to
 * needing an approver — which is what the code being rolled back to does anyway.
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db
    .collection('organizations')
    .updateMany({ approvalSettings: { $exists: true } }, { $unset: { approvalSettings: '' } });
  await db
    .collection('assets')
    .updateMany({ approvalMode: { $exists: true } }, { $unset: { approvalMode: '' } });
};
