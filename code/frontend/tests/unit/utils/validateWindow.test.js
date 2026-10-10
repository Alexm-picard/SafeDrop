// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code for SCRUM-124)
// AI-Assisted Areas: tests pinning the client-side mirror of the createRequestBody window rule
// Human Contributions: reviewed and approved by Alex Picard (PR #37, 2026-09-20); latest changes reviewed and approved by Alex Picard (PR #69, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL

/**
 * Tests for `validateWindow` (SCRUM-124).
 *
 * This function is a deliberate duplicate of the backend's `createRequestBody` refine, so these
 * tests exist to pin the rule it mirrors — most of all that "after" is strict, since an off-by-one
 * here would let a same-day request through to a 400 the member cannot explain.
 */
import { describe, expect, it } from 'vitest';
import { toUtcWindow, validateWindow } from '../../../src/utils/requestWindow';

/** Build a form value set, overriding the fields a case cares about. */
const values = (over = {}) => ({ neededFrom: '', neededTo: '', note: '', ...over });

describe('validateWindow', () => {
  it('accepts an ordered window', () => {
    expect(validateWindow(values({ neededFrom: '2026-10-01', neededTo: '2026-10-02' }))).toEqual(
      {},
    );
  });

  it('requires both dates', () => {
    const errors = validateWindow(values());
    expect(errors.neededFrom).toBeDefined();
    expect(errors.neededTo).toBeDefined();
  });

  it('rejects an end date before the start, reporting against neededTo', () => {
    const errors = validateWindow(values({ neededFrom: '2026-10-10', neededTo: '2026-10-01' }));
    expect(errors.neededTo).toBe('The end date must be after the start date.');
    expect(errors.neededFrom).toBeUndefined();
  });

  it('rejects equal dates, because the schema wants strictly after', () => {
    const errors = validateWindow(values({ neededFrom: '2026-10-01', neededTo: '2026-10-01' }));
    expect(errors.neededTo).toBe('The end date must be after the start date.');
  });

  it('compares across month and year boundaries', () => {
    expect(validateWindow(values({ neededFrom: '2026-12-31', neededTo: '2027-01-01' }))).toEqual(
      {},
    );
    expect(
      validateWindow(values({ neededFrom: '2027-01-01', neededTo: '2026-12-31' })).neededTo,
    ).toBeDefined();
  });

  it('does not complain about the ordering when a date is still missing', () => {
    const errors = validateWindow(values({ neededFrom: '2026-10-01' }));
    expect(errors.neededTo).toBe('Choose the date you need it until.');
  });

  it('caps the note at the schema’s 1000 characters', () => {
    expect(validateWindow(values({ note: 'x'.repeat(1000) })).note).toBeUndefined();
    expect(validateWindow(values({ note: 'x'.repeat(1001) })).note).toBeDefined();
  });
});

/**
 * SCRUM-240: the picked days are the member's local days, sent as UTC instants. These run in
 * America/New_York (pinned by vitest.config.js), west of UTC, which is where the old bare-date
 * submission showed every request a day early.
 */
describe('toUtcWindow', () => {
  it('sends the start of the first day and the end of the last, in local time', () => {
    expect(toUtcWindow({ neededFrom: '2026-10-12', neededTo: '2026-10-15' })).toEqual({
      neededFrom: '2026-10-12T04:00:00.000Z',
      neededTo: '2026-10-16T03:59:59.999Z',
    });
  });

  it('round-trips to the same local days, so nothing displays a day early', () => {
    const { neededFrom, neededTo } = toUtcWindow({
      neededFrom: '2026-10-12',
      neededTo: '2026-10-15',
    });
    const from = new Date(neededFrom);
    const to = new Date(neededTo);
    expect([from.getFullYear(), from.getMonth() + 1, from.getDate()]).toEqual([2026, 10, 12]);
    expect([to.getFullYear(), to.getMonth() + 1, to.getDate()]).toEqual([2026, 10, 15]);
    expect([to.getHours(), to.getMinutes(), to.getSeconds()]).toEqual([23, 59, 59]);
  });

  it('follows the local offset across the November daylight-saving change', () => {
    // Nov 1 starts in EDT (UTC-4); Nov 2 ends in EST (UTC-5).
    expect(toUtcWindow({ neededFrom: '2026-11-01', neededTo: '2026-11-02' })).toEqual({
      neededFrom: '2026-11-01T04:00:00.000Z',
      neededTo: '2026-11-03T04:59:59.999Z',
    });
  });

  it('follows the local offset across the March daylight-saving change', () => {
    // Mar 7 starts in EST (UTC-5); Mar 8 ends in EDT (UTC-4).
    expect(toUtcWindow({ neededFrom: '2026-03-07', neededTo: '2026-03-08' })).toEqual({
      neededFrom: '2026-03-07T05:00:00.000Z',
      neededTo: '2026-03-09T03:59:59.999Z',
    });
  });

  it('keeps the window ordered, so the server’s neededTo > neededFrom check still passes', () => {
    const { neededFrom, neededTo } = toUtcWindow({
      neededFrom: '2026-12-31',
      neededTo: '2027-01-01',
    });
    expect(new Date(neededTo) > new Date(neededFrom)).toBe(true);
  });
});
