// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code for SCRUM-124)
// AI-Assisted Areas: client-side mirror of the createRequestBody date-window rule
// Human Contributions: pending team review
// Notes: Mirrors the `createRequestBody` Zod schema in backend routes/requests.routes.js — change
// both together. Verified by tests/unit/utils/validateWindow.test.js. Must be reviewed by the owning
// team member before merge.

/**
 * Validation for the checkout request window, as the SPA understands it.
 *
 * A pure helper rather than a function inside RequestUnitForm, for the same reason `requestState.js`
 * is separate: it is logic with no DOM in it, so it can be tested directly instead of through a form.
 */

/**
 * Check the window the same way `createRequestBody` does, before spending a round trip on it.
 *
 * This mirrors the schema's `.refine()` — `neededTo > neededFrom`, reported against `neededTo` — and
 * its `note` ceiling. The duplication is deliberate and has the same justification as
 * `utils/requestState.js`: the browser has to be able to say "those dates are the wrong way round"
 * without asking the server. **Change this and the schema together.** The server validates
 * regardless, so this is a courtesy, never the guarantee (SR-6, G4).
 *
 * Both dates are required here although the schema expresses that only through `z.coerce.date()`
 * rejecting an empty string — the message a user needs for a blank field is "this is required", not
 * "invalid date".
 * @param {{ neededFrom: string, neededTo: string, note: string }} values
 * @returns {Record<string, string>} field name to message; empty when the form is acceptable
 */
export function validateWindow(values) {
  const errors = {};
  if (!values.neededFrom) {
    errors.neededFrom = 'Choose the date you need it from.';
  }
  if (!values.neededTo) {
    errors.neededTo = 'Choose the date you need it until.';
  }
  if (values.neededFrom && values.neededTo && values.neededTo <= values.neededFrom) {
    // Both are `<input type="date">` values, so they are ISO `YYYY-MM-DD` and compare correctly as
    // strings — no Date construction, and so no timezone to shift the comparison across midnight.
    errors.neededTo = 'The end date must be after the start date.';
  }
  if (values.note.length > 1000) {
    errors.note = 'Keep the note under 1000 characters.';
  }
  return errors;
}

/**
 * Turn a `<input type="date">` value into a local `Date` at the given time of day.
 *
 * Built from parts, never `new Date('2026-10-12')`: that form is parsed as midnight *UTC*, which is
 * the evening before for anyone west of Greenwich — the bug SCRUM-240 fixes.
 * @param {string} day `YYYY-MM-DD`
 * @param {[number, number, number, number]} time hours, minutes, seconds, milliseconds
 * @returns {Date}
 */
function localDay(day, [h, min, s, ms]) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, h, min, s, ms);
}

/**
 * Convert the picked days into the UTC instants the API stores (SCRUM-240).
 *
 * The member picks days on their own calendar, so both are read in the browser's local time zone:
 * `neededFrom` is the first instant of its day and `neededTo` the last, so "needed until Oct 15"
 * means the loan is due at the end of Oct 15 where the member is, not at the start of it. Both are
 * sent as ISO strings in UTC; the database stores UTC, and every screen converts back to the
 * viewer's local time to display them.
 * @param {{ neededFrom: string, neededTo: string }} values validated `YYYY-MM-DD` days
 * @returns {{ neededFrom: string, neededTo: string }} ISO 8601 UTC instants
 */
export function toUtcWindow({ neededFrom, neededTo }) {
  return {
    neededFrom: localDay(neededFrom, [0, 0, 0, 0]).toISOString(),
    neededTo: localDay(neededTo, [23, 59, 59, 999]).toISOString(),
  };
}
