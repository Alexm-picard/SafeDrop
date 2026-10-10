// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-206 story)
// AI-Assisted Areas: indexes for the new searchquerylogs collection, including the retention TTL (SCRUM-206 AT-5)
// Human Contributions: pending review
// Notes: Written for SCRUM-206. Must be reviewed and tested by the owning team member before merge.

/**
 * Migration: index the `searchquerylogs` collection (SCRUM-206).
 *
 * `timestamp_ttl` is the retention rule (AT-5). MongoDB itself deletes a row once its `timestamp` is
 * more than 90 days old, so retention does not depend on a scheduled job remembering to run — the
 * backend has no job scheduler, and the TTL monitor is already running in every MongoDB, Atlas
 * included. It sweeps about once a minute, so a row can outlive the window by that much.
 *
 * The number is written out here rather than imported from utils/constants.js: a migration records
 * what was applied at the time, and must not change meaning when the constant does. Changing the
 * window means a new migration (`collMod` with a new `expireAfterSeconds`) and the constant together;
 * a test checks the two agree.
 *
 * `orgId_timestamp` serves the admin summary, which always filters by organisation and date range,
 * and leads with `orgId` like every other tenant index.
 */

const RETENTION_SECONDS = 90 * 24 * 60 * 60;

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db.collection('searchquerylogs').createIndexes([
    { key: { orgId: 1, timestamp: -1 }, name: 'orgId_timestamp' },
    { key: { timestamp: 1 }, name: 'timestamp_ttl', expireAfterSeconds: RETENTION_SECONDS },
  ]);
};

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const drop = async (name) => {
    try {
      await db.collection('searchquerylogs').dropIndex(name);
    } catch (_err) {
      // index (or collection) already gone
    }
  };
  await drop('orgId_timestamp');
  await drop('timestamp_ttl');
};
