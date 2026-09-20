// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: formatter tests
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Tests for the display formatters.
 *
 * Each one is given garbage as well as valid input — an unparseable date, a non-number, an empty
 * string — because these run in table cells where missing data is normal and must render as an em dash
 * rather than as `Invalid Date`, `NaN`, or an exception.
 */
import { describe, expect, it } from 'vitest';
import { formatCount, formatDate, formatDay, humanize, pluralize } from '../../../src/utils/format';
describe('format', () => {
  it('formatDate handles dates, strings and garbage', () => {
    expect(formatDate('2026-10-01T12:00:00Z')).toMatch(/2026/);
    expect(formatDate(new Date('2026-10-01T12:00:00Z'))).toMatch(/Oct/);
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });
  it('formatDay renders the API’s day buckets in UTC', () => {
    // Read as UTC, not local: west of Greenwich, a local reading would show this as Sep 19.
    expect(formatDay('2026-09-20')).toBe('Sep 20');
    expect(formatDay(null)).toBe('—');
    expect(formatDay('')).toBe('—');
    expect(formatDay('not a date')).toBe('—');
  });
  it('formatCount and pluralize', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(undefined)).toBe('—');
    expect(pluralize(1, 'asset')).toBe('1 asset');
    expect(pluralize(3, 'asset')).toBe('3 assets');
    expect(pluralize(2, 'entry', 'entries')).toBe('2 entries');
  });
  it('humanize', () => {
    expect(humanize('CHECKED_OUT')).toBe('Checked out');
    expect(humanize('ORG_ADMIN')).toBe('Org admin');
    expect(humanize('')).toBe('');
  });
});
