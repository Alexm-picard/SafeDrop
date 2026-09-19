// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the invitation-link request)
// AI-Assisted Areas: unique index on the invitation token hash
// Human Contributions: pending team review
// Notes: Follows the pattern of the initial-indexes migration. Must be reviewed by the owning team member before merge.

/**
 * Migration: index the invitation token so accepting an invitation is a lookup, not a scan.
 *
 * Accepting an invitation is a public route with no verified tenant, so the user is found by the hash of
 * the token alone. That needs an index — and a *unique* one, both because two invitations must never
 * share a token and because it is what guarantees the lookup finds at most one account.
 *
 * It is a partial index over documents that actually have a token. Most users never had one, or have
 * accepted and had it cleared, and they should cost the index nothing.
 */

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db.collection('users').createIndexes([
    {
      key: { inviteTokenHash: 1 },
      name: 'inviteTokenHash_unique',
      unique: true,
      partialFilterExpression: { inviteTokenHash: { $type: 'string' } },
    },
  ]);
};

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  try {
    await db.collection('users').dropIndex('inviteTokenHash_unique');
  } catch (_err) {
    // index (or collection) already gone
  }
};
