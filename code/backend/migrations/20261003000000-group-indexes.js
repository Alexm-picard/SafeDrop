// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the user-groups ticket)
// AI-Assisted Areas: indexes for the new usergroups collection (SCRUM-149)
// Human Contributions: reviewed and approved by Alex Picard (PR #59, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Written for the user-groups ticket. Reviewed before merge; see Human Contributions.

/**
 * Migration: index the `usergroups` collection.
 *
 * `orgId_nameLower_unique` is what makes a group name unique *within* an organisation, in any letter
 * case, while letting two organisations each have their own "Film Dept Staff" (AT-4) — the same
 * `{ orgId, X }` unique-index pattern as `users.orgId_email_unique` and `assetunits.orgId_tag_unique`.
 * The service's pre-check for a duplicate name is a courtesy; this index is the real guarantee against
 * two concurrent creates racing each other to the same name.
 *
 * `orgId_memberIds` is a multikey index (Mongo indexes each element of an array field separately) that
 * speeds up "which groups is this user in", the query a future restricted-equipment eligibility check
 * will run on every request. It is not unique — a user may belong to several groups — and it leads with
 * `orgId` like every other tenant index, so the lookup is scoped before it ever touches `memberIds`.
 */

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db.collection('usergroups').createIndexes([
    { key: { orgId: 1, nameLower: 1 }, name: 'orgId_nameLower_unique', unique: true },
    { key: { orgId: 1, memberIds: 1 }, name: 'orgId_memberIds' },
  ]);
};

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const drop = async (name) => {
    try {
      await db.collection('usergroups').dropIndex(name);
    } catch (_err) {
      // index (or collection) already gone
    }
  };
  await drop('orgId_nameLower_unique');
  await drop('orgId_memberIds');
};
