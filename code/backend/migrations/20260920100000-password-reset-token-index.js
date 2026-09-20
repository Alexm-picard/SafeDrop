// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: unique partial index on users.resetTokenHash for the password-reset lookup
// Human Contributions: pending team review
// Notes: Written for SCRUM-22. Must be reviewed and tested by the owning team member before merge.

/**
 * Migration: index the password-reset token.
 *
 * Completing a reset is a public request carrying nothing but the token, so the user is found by the
 * hash of that token alone, across every organisation. That lookup needs an index — and a *unique*
 * one, both because two live reset tokens must never collide and because it is what guarantees the
 * lookup matches at most one account.
 *
 * Partial, over documents that actually hold a token: almost every user has none at any moment, and
 * a plain unique index would also treat all those nulls as duplicates.
 *
 * Deliberately not a TTL index. Expiry is enforced in the service by comparing `resetTokenExpiresAt`,
 * because a TTL monitor runs about once a minute and would leave a ten-minute link usable for up to
 * eleven — and, worse, would delete the *user document* rather than the fields if ever misapplied.
 */

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db.collection('users').createIndexes([
    {
      key: { resetTokenHash: 1 },
      name: 'resetTokenHash_unique',
      unique: true,
      partialFilterExpression: { resetTokenHash: { $type: 'string' } },
    },
  ]);
};

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  try {
    await db.collection('users').dropIndex('resetTokenHash_unique');
  } catch (_err) {
    // index (or collection) already gone
  }
};
