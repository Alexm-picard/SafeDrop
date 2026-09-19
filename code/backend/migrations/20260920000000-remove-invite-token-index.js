// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code)
// AI-Assisted Areas: removes the invitation-token index and fields left by the link-based invite
// Human Contributions: pending team review
// Notes: A new migration rather than an edit to 20260919000000, which may already have run somewhere. Must be reviewed by the owning team member before merge.

/**
 * Migration: remove the invitation-link leftovers from `users`.
 *
 * The link-based invitation (an emailed or copied one-time link) was replaced by an admin-set initial
 * password, so nothing reads or writes `inviteTokenHash` / `inviteExpiresAt` any more. This drops the
 * unique index created by 20260919000000-invite-token-index.js and clears the two fields.
 *
 * This is a **new** migration on purpose: the earlier one may already have been applied to a database, and
 * an applied migration must not be edited.
 *
 * Note for anyone with existing data: a user created by the old link flow who never accepted has no
 * usable password (their hash is of a random value). Clearing the invitation fields does not change that;
 * such an account cannot sign in, and because email is unique per organisation it cannot simply be invited
 * again. There is no delete-member or reset-password feature yet, so such an account needs fixing by hand.
 */

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  try {
    await db.collection('users').dropIndex('inviteTokenHash_unique');
  } catch (_err) {
    // index (or collection) already gone
  }
  await db
    .collection('users')
    .updateMany(
      { $or: [{ inviteTokenHash: { $exists: true } }, { inviteExpiresAt: { $exists: true } }] },
      { $unset: { inviteTokenHash: '', inviteExpiresAt: '' } },
    );
};

/**
 * Recreate the index. The cleared field values are not restored: they were single-use secrets.
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db.collection('users').createIndexes([
    {
      key: { inviteTokenHash: 1 },
      name: 'inviteTokenHash_unique',
      unique: true,
      partialFilterExpression: { inviteTokenHash: { $type: 'string' } },
    },
  ]);
};
