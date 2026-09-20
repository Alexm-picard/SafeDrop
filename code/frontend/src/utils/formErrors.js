// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code for SCRUM-122)
// AI-Assisted Areas: shared mapping from an ApiError to per-field form messages
// Human Contributions: pending team review
// Notes: Lifted verbatim from the local copy in MembersPage.jsx, which now imports it, so the two
// cannot drift. Verified by tests/unit/utils/formErrors.test.js. Must be reviewed by the owning team
// member before merge.

/**
 * Turning API errors into messages that sit beside the input that caused them.
 *
 * Two different shapes arrive from the backend and both belong next to a field rather than in a
 * banner, so they are folded together here once instead of in every form.
 */

/**
 * Work out which form field, if any, an API error belongs to.
 *
 * A 400 lists its problems per field (`fieldErrors()`), but a conflict — a duplicate email, a
 * duplicate unit tag — carries a single `{ field }` in `details` instead. Folding the second shape
 * into the first means a form can render both the same way: a 409 for a tag already in use shows
 * under the tag input, where the admin can fix it, rather than as a banner they have to map back to
 * a field themselves.
 * @param {import('../services/api').ApiError} err
 * @returns {Record<string, string>} field path to message; empty when the error was not field-specific
 */
export function fieldErrorsOf(err) {
  const perField = err.fieldErrors();
  const single = err.details && !Array.isArray(err.details) ? err.details.field : null;
  if (typeof single === 'string' && !(single in perField)) {
    perField[single] = err.message;
  }
  return perField;
}
