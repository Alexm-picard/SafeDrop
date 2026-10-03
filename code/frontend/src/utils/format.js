// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: small display formatters; restrictionNote for restricted equipment (SCRUM-150, SCRUM-203)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Display formatting helpers.
 *
 * All of them are total: given nonsense — null, an unparseable date, a NaN — they return an em dash or
 * an empty string rather than throwing or rendering "Invalid Date". A table cell with missing data
 * should look empty, not broken.
 *
 * The `Intl` formatters are created once at module load, since constructing them per call is
 * surprisingly expensive in a list.
 */
const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
// UTC, because the values it formats are the API's `YYYY-MM-DD` day buckets: rendering those in the
// browser's timezone would shift a day westward of Greenwich onto the day before.
const dayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const numberFormatter = new Intl.NumberFormat('en-US');
/**
 * Format a date for display: `"Sep 16, 2026, 7:00 PM"`.
 *
 * Accepts a Date or anything `new Date()` understands (the API sends ISO strings). Missing values and
 * unparseable input both return an em dash.
 * @param {Date|string|number|null|undefined} value
 * @returns {string} the formatted date, or `'—'`
 */
export function formatDate(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}
/**
 * Format one of the API's day buckets for an axis or a table: `'2026-09-20'` → `"Sep 20"`.
 *
 * The year is left off deliberately — these appear thirty at a time along an axis, where it would be
 * the same on nearly every label and is already given by the chart's own description.
 * @param {string|null|undefined} value a `YYYY-MM-DD` date
 * @returns {string} the formatted day, or `'—'`
 */
export function formatDay(value) {
  if (!value) {
    return '—';
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '—' : dayFormatter.format(date);
}
/**
 * Format a number with thousands separators.
 *
 * Non-numbers, `NaN` and infinities return an em dash — a count that has not loaded yet should show
 * as absent rather than as `NaN`.
 * @param {unknown} value
 * @returns {string} the formatted number, or `'—'`
 */
export function formatCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormatter.format(value) : '—';
}
/**
 * Format a count with the right singular or plural noun: `"1 asset"`, `"3 assets"`.
 *
 * The plural defaults to the singular plus `s`, and can be given explicitly for irregular words.
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural]
 * @returns {string}
 */
export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
/**
 * Turn a SCREAMING_SNAKE_CASE value into readable text: `"CHECKED_OUT"` → `"Checked out"`.
 *
 * Used for enum values that come straight from the API — request states, unit statuses — so a new
 * value added on the backend still displays sensibly instead of needing a label map. Only the first
 * word is capitalised, which is what makes it read as a sentence fragment rather than a title.
 * @param {string} value
 * @returns {string} the humanised text, or `''` when there is nothing left after splitting
 */
export function humanize(value) {
  const words = value.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  return words
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}
/**
 * "Only members of A, B or C can request this" — who may request a restricted asset (SCRUM-150), with
 * the groups joined the way a person would say them, so it reads naturally for one group or several.
 *
 * An asset can be restricted with no names left to show, when every group it listed was deleted
 * (SCRUM-203); nobody can request it then, and passing `restricted: true` says so instead of
 * returning nothing.
 * @param {{ name: string }[]} allowedGroups
 * @param {{ restricted?: boolean }} [options]
 * @returns {string} the sentence, without a full stop; `''` for an unrestricted asset
 */
export function restrictionNote(allowedGroups, { restricted = false } = {}) {
  const names = (allowedGroups ?? []).map((g) => g.name);
  if (names.length === 0) {
    return restricted
      ? 'It is restricted to groups that no longer exist, so nobody can request it'
      : '';
  }
  const who =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
  return `Only members of ${who} can request this`;
}
