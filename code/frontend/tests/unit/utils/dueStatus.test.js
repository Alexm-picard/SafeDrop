// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-143 ticket)
// AI-Assisted Areas: test-first specification of the due badge's logic, including the calendar-day
// and timezone decision the ticket left to the implementer
// Human Contributions: pending team review
// Notes: Written test-first for SCRUM-143 (Lab 3, TDD). Every test here was written and watched to
// fail before src/utils/dueStatus.js existed. Must be reviewed by the owning team member before merge.

/**
 * Tests for the due-date badge's logic (SCRUM-143).
 *
 * The logic lives in a pure function, and these tests are the reason: "is this late, and by how
 * much" is arithmetic over two dates, and arithmetic is worth testing directly rather than through a
 * rendered table where a wrong answer shows up as a string in a cell. The badge's markup is tested
 * separately, in `tests/unit/components/DueBadge.test.jsx`.
 *
 * **`now` is always passed in.** A function that reads the clock itself can only be tested against
 * whatever time it happens to be, which is how "passes in the morning, fails after midnight" bugs
 * get written. Every case below states both instants.
 *
 * **The ticket left one decision open, and these tests close it: a day is a square on the viewer's
 * calendar, not a 24-hour period, and the calendar is the browser's, not UTC.** Two consequences,
 * both pinned below:
 *
 *  - Sixteen hours can be "tomorrow" and twenty-three hours can be "today". What a member compares
 *    the badge against is the date printed next to it, not a stopwatch.
 *  - A `dueAt` of midnight UTC — which is what the seed data has — is 8 pm the *previous* day in
 *    Boston, and the badge says so, because `formatDate` renders that same instant as the previous
 *    day right beside it. A UTC reading would put the badge and the date it labels on different days.
 *
 * The timezone is pinned to `America/New_York` in `vitest.config.js`, so these keep their meaning on
 * a machine set to UTC as CI is.
 */
import { describe, expect, it } from 'vitest';
import { dueStatus } from '../../../src/utils/dueStatus';
import { formatDate } from '../../../src/utils/format';

/**
 * A local-time `Date`, written the way a member reads a calendar.
 *
 * Months are 1-based here, unlike the `Date` constructor's: `at(2026, 9, 13)` is the thirteenth of
 * September, which is what the test above it says it is. Local rather than UTC because local is what
 * the badge counts in.
 * @param {number} year
 * @param {number} month 1 for January
 * @param {number} day
 * @param {number} [hour]
 * @param {number} [minute]
 * @returns {Date}
 */
const at = (year, month, day, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);

/** A request that is out on loan and due back at `dueAt`. */
const out = (dueAt) => ({ state: 'CHECKED_OUT', dueAt });

describe('dueStatus: when there is no badge to show', () => {
  it('shows nothing for a request with no due date', () => {
    // Nothing is due until it has actually been handed over, and the API leaves `dueAt` null until
    // then. An absent deadline is normal, not an error, so it is a missing badge rather than an
    // empty one.
    const now = at(2026, 9, 13, 9);
    expect(dueStatus(out(null), now)).toBeNull();
    expect(dueStatus(out(undefined), now)).toBeNull();
    expect(dueStatus(out(''), now)).toBeNull();
    // Including in the OVERDUE state: with no deadline there is no count to show.
    expect(dueStatus({ state: 'OVERDUE', dueAt: null }, now)).toBeNull();
  });

  it('shows nothing for a state that is not out on loan', () => {
    // Only a request that has left the shelf can be due back. A pending one has no deadline yet and
    // a returned one no longer has one, and a badge on either would be noise in the row.
    const now = at(2026, 9, 13, 9);
    const dueAt = at(2026, 9, 20, 17);
    for (const state of ['PENDING', 'APPROVED', 'DENIED', 'CANCELLED', 'RETURNED', 'LOST']) {
      expect(dueStatus({ state, dueAt }, now)).toBeNull();
    }
  });

  it('shows nothing rather than "Invalid Date" for junk', () => {
    // Total in the same way the formatters in utils/format.js are total: this runs in a table cell,
    // where a broken record must render as an empty cell and never as an exception that takes the
    // whole list down with it.
    const now = at(2026, 9, 13, 9);
    expect(dueStatus(out('not a date'), now)).toBeNull();
    expect(dueStatus(null, now)).toBeNull();
    expect(dueStatus(undefined, now)).toBeNull();
    expect(dueStatus({}, now)).toBeNull();
  });
});

describe('dueStatus: while the item is still out', () => {
  it('counts whole days ahead once there are two or more', () => {
    const now = at(2026, 9, 13, 9);
    expect(dueStatus(out(at(2026, 9, 15, 17)), now)).toEqual({
      label: 'Due in 2 days',
      tone: 'ok',
    });
    expect(dueStatus(out(at(2026, 9, 20, 17)), now)).toEqual({
      label: 'Due in 7 days',
      tone: 'ok',
    });
  });

  it('names today and tomorrow instead of counting them', () => {
    // "Due in 1 days" is the giveaway of a badge nobody read aloud, and "Due in 0 days" is worse.
    // The two nearest days get words; everything past them gets a number.
    const now = at(2026, 9, 13, 9);
    expect(dueStatus(out(at(2026, 9, 13, 17)), now)).toEqual({
      label: 'Due today',
      tone: 'soon',
    });
    expect(dueStatus(out(at(2026, 9, 14, 17)), now)).toEqual({
      label: 'Due tomorrow',
      tone: 'soon',
    });
  });

  it('counts calendar days, not 24-hour periods (the decision)', () => {
    // 5 pm today to 9 am tomorrow is sixteen hours — less than a day — but they are different
    // squares on the calendar, and "tomorrow" is what a member reads off the date beside it.
    expect(dueStatus(out(at(2026, 9, 14, 9)), at(2026, 9, 13, 17))).toEqual({
      label: 'Due tomorrow',
      tone: 'soon',
    });
    // Fifteen hours the other way round is still "today", however long it is.
    expect(dueStatus(out(at(2026, 9, 13, 23, 59)), at(2026, 9, 13, 9))).toEqual({
      label: 'Due today',
      tone: 'soon',
    });
    // And barely over a day of real time is "in 2 days", because two midnights lie between them.
    expect(dueStatus(out(at(2026, 9, 15, 9)), at(2026, 9, 13, 23))).toEqual({
      label: 'Due in 2 days',
      tone: 'ok',
    });
  });

  it('accepts a Date or the ISO string the API actually sends', () => {
    // The API sends ISO strings; the tests here are easier to read with Dates. Both must work, for
    // the same reason `formatDate` takes both.
    const now = at(2026, 9, 13, 9);
    const dueAt = at(2026, 9, 16, 17);
    expect(dueStatus(out(dueAt.toISOString()), now)).toEqual(dueStatus(out(dueAt), now));
    expect(dueStatus(out(dueAt.toISOString()), now)).toEqual({
      label: 'Due in 3 days',
      tone: 'ok',
    });
  });
});

describe('dueStatus: once it is late', () => {
  it('counts the days since it was due, singular and plural', () => {
    // "Overdue by 1 days" is the bug this test exists to catch.
    const dueAt = at(2026, 9, 13, 17);
    expect(dueStatus(out(dueAt), at(2026, 9, 14, 9))).toEqual({
      label: 'Overdue by 1 day',
      tone: 'late',
    });
    expect(dueStatus(out(dueAt), at(2026, 9, 15, 9))).toEqual({
      label: 'Overdue by 2 days',
      tone: 'late',
    });
    expect(dueStatus(out(dueAt), at(2026, 10, 3, 9))).toEqual({
      label: 'Overdue by 20 days',
      tone: 'late',
    });
  });

  it('is a full day late as soon as the date has turned over', () => {
    // Sixteen hours past a 5 pm deadline is already "1 day", never "0 days" and never still "today".
    // Counting calendar days is what makes that fall out without a special case.
    expect(dueStatus(out(at(2026, 9, 13, 17)), at(2026, 9, 14, 9))).toEqual({
      label: 'Overdue by 1 day',
      tone: 'late',
    });
  });
});

describe('dueStatus: the boundaries', () => {
  it('is still due today at the exact moment it falls due', () => {
    // The deadline instant itself has not been missed. A member looking at the screen at 5 pm sharp
    // is not late, and the badge should not tell them they are.
    const moment = at(2026, 9, 13, 17);
    expect(dueStatus(out(moment), moment)).toEqual({ label: 'Due today', tone: 'soon' });
  });

  it('flips at local midnight and at no other hour', () => {
    // The whole of the due day reads "Due today", however far past the hour it is; the first minute
    // of the next day reads late. This is the boundary the calendar-day decision puts it at.
    const dueAt = at(2026, 9, 13, 17);
    expect(dueStatus(out(dueAt), at(2026, 9, 13, 23, 59))).toEqual({
      label: 'Due today',
      tone: 'soon',
    });
    expect(dueStatus(out(dueAt), at(2026, 9, 14, 0, 0))).toEqual({
      label: 'Overdue by 1 day',
      tone: 'late',
    });
    expect(dueStatus(out(dueAt), at(2026, 9, 14, 0, 1))).toEqual({
      label: 'Overdue by 1 day',
      tone: 'late',
    });
  });

  it('reads the stored instant on the viewer’s calendar, not on UTC’s (the decision)', () => {
    // `dueAt` is stored in UTC and the seed data uses midnight UTC, which is 8 pm the previous
    // evening in Boston. `formatDate` prints it as the 13th, so the badge must agree and call the
    // 13th its due day — a UTC reading would print "Sep 13" and say "Due tomorrow" in the same
    // breath. This test is the reason vitest.config.js pins TZ.
    const seeded = out('2026-09-14T00:00:00.000Z');
    expect(formatDate(seeded.dueAt)).toContain('Sep 13');
    expect(dueStatus(seeded, at(2026, 9, 12, 9))).toEqual({
      label: 'Due tomorrow',
      tone: 'soon',
    });
    expect(dueStatus(seeded, at(2026, 9, 13, 9))).toEqual({ label: 'Due today', tone: 'soon' });
    expect(dueStatus(seeded, at(2026, 9, 14, 9))).toEqual({
      label: 'Overdue by 1 day',
      tone: 'late',
    });
  });
});

describe('dueStatus: the OVERDUE state', () => {
  it('is late whatever the dates say', () => {
    // The backend flags a request OVERDUE on its own schedule. Where the flag and the arithmetic
    // disagree — a clock skew, a due date edited after the flag was set — the flag wins: it is the
    // organisation's decision about the request, and the badge must not argue with the state shown
    // in the next column. With no days to count, the word alone is the honest label.
    expect(dueStatus({ state: 'OVERDUE', dueAt: at(2026, 9, 20, 17) }, at(2026, 9, 13, 9))).toEqual(
      { label: 'Overdue', tone: 'late' },
    );
    expect(dueStatus({ state: 'OVERDUE', dueAt: at(2026, 9, 13, 17) }, at(2026, 9, 13, 9))).toEqual(
      { label: 'Overdue', tone: 'late' },
    );
  });

  it('counts the days when the flag and the dates agree', () => {
    expect(dueStatus({ state: 'OVERDUE', dueAt: at(2026, 9, 13, 17) }, at(2026, 9, 16, 9))).toEqual(
      { label: 'Overdue by 3 days', tone: 'late' },
    );
  });

  it('gives a checked-out request the same badge an overdue one gets', () => {
    // The overdue-flagging story has not shipped, so a late request is still CHECKED_OUT in the
    // database. The badge must not wait for that story to tell a member they are late — and must
    // not change its mind when it does ship.
    const dueAt = at(2026, 9, 13, 17);
    const now = at(2026, 9, 16, 9);
    expect(dueStatus({ state: 'CHECKED_OUT', dueAt }, now)).toEqual(
      dueStatus({ state: 'OVERDUE', dueAt }, now),
    );
  });
});

describe('dueStatus: the default clock', () => {
  it('falls back to the current time when no `now` is given', () => {
    // The pages have no clock of their own to pass, so omitting it must work. Built by calendar
    // arithmetic from whenever this runs, so the expectation holds at any hour of any day.
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    expect(dueStatus(out(inThreeDays))).toEqual({ label: 'Due in 3 days', tone: 'ok' });
  });
});
