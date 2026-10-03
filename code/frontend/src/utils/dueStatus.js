// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code against the SCRUM-143 tests)
// AI-Assisted Areas: calendar-day arithmetic for the due badge, written to turn the pre-existing
// tests in tests/unit/utils/dueStatus.test.js green
// Human Contributions: pending team review
// Notes: The green half of the Lab 3 red-green-refactor cycle for SCRUM-143; the tests were written
// first and watched to fail. Must be reviewed by the owning team member before merge.

/**
 * How a borrowed item's deadline reads at a glance (SCRUM-143).
 *
 * A pure function rather than logic inside the two screens that show it, for the same reason
 * `requestWindow.js` is separate: "is this late, and by how much" is arithmetic over two dates, and
 * arithmetic is worth testing directly instead of through a rendered table cell.
 *
 * **A day here is a square on the viewer's calendar, not a 24-hour period, and the calendar is the
 * browser's rather than UTC.** That was the open decision on the ticket, and the reason is what sits
 * next to the badge: `formatDate` renders `dueAt` in the browser's zone, so a UTC reading would
 * print "Sep 13" and say "Due tomorrow" in the same breath. It also matches how a member thinks —
 * something due tomorrow evening is "tomorrow" at nine in the morning and at five in the afternoon,
 * though the hours left differ by eight. `tests/unit/utils/dueStatus.test.js` pins both, and pins
 * the timezone with them.
 */
import { pluralize } from './format';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The states in which something is actually out and therefore can be due back.
 *
 * Nothing is due until it has been handed over, and a returned item is not due any more, so every
 * other state has no deadline to describe. OVERDUE is included because the backend flags it
 * separately — see the note in `dueStatus` about which wins.
 */
// RETURN_PENDING (SCRUM-205) is still out: the borrower's word that it is back is not a confirmed
// return, so the deadline still applies until someone confirms it.
const OUT_ON_LOAN = Object.freeze(['CHECKED_OUT', 'OVERDUE', 'RETURN_PENDING']);

/**
 * Midnight at the start of `date`'s day, in the browser's timezone.
 *
 * Going through the local `Date` constructor is what makes the comparison a calendar one: it throws
 * away the time of day, so two instants on the same local date become the same value however many
 * hours separate them.
 * @param {Date} date
 * @returns {Date}
 */
function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Describe a request's deadline, or say there is nothing to describe.
 *
 * `now` is a parameter rather than a `new Date()` inside, so the tests state both instants and never
 * depend on the clock they happen to run under. The pages leave it out and get the current time.
 *
 * Returns `null` — no badge at all — for a request with no deadline, one that is not out on loan,
 * and one whose `dueAt` will not parse. Total in the same way the formatters in `format.js` are
 * total: this runs in a table cell, where a broken record must render as an empty cell rather than
 * as an exception that takes the whole list down with it.
 *
 * @param {{ state: string, dueAt: Date|string|null }} request
 * @param {Date} [now] the instant to measure against; defaults to the current time
 * @returns {{ label: string, tone: 'ok'|'soon'|'late' }|null} `tone` is a styling hint only — the
 *   label says the same thing in words, so colour is never the only thing carrying it (WCAG 1.4.1)
 */
export function dueStatus(request, now = new Date()) {
  if (!request?.state || !OUT_ON_LOAN.includes(request.state) || !request.dueAt) {
    return null;
  }
  const dueAt = request.dueAt instanceof Date ? request.dueAt : new Date(request.dueAt);
  if (Number.isNaN(dueAt.getTime())) {
    return null;
  }

  // Rounded, not floored: a daylight-saving change makes one day 23 or 25 hours long, which would
  // otherwise turn a whole number of calendar days into 0.958 or 1.042 and lose or gain a day twice
  // a year. Both ends are already at local midnight, so rounding can only correct that skew.
  const days = Math.round((startOfLocalDay(dueAt) - startOfLocalDay(now)) / DAY_MS);

  if (days < 0) {
    return { label: `Overdue by ${pluralize(-days, 'day')}`, tone: 'late' };
  }
  if (request.state === 'OVERDUE') {
    // The organisation has flagged this late and the arithmetic disagrees — a clock skew, or a due
    // date edited after the flag was set. The flag wins: it is the decision of record, and the badge
    // must not argue with the state shown in the next column. With no days to count, the bare word
    // is the only honest label.
    return { label: 'Overdue', tone: 'late' };
  }
  if (days === 0) {
    return { label: 'Due today', tone: 'soon' };
  }
  if (days === 1) {
    return { label: 'Due tomorrow', tone: 'soon' };
  }
  // Two days out and beyond gets a number. The two nearest days get words instead, because "Due in
  // 1 days" is the giveaway of a badge nobody read aloud and "Due in 0 days" is worse.
  return { label: `Due in ${pluralize(days, 'day')}`, tone: 'ok' };
}
