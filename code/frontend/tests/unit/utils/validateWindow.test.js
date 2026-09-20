// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code for SCRUM-124)
// AI-Assisted Areas: tests pinning the client-side mirror of the createRequestBody window rule
// Human Contributions: pending team review

/**
 * Tests for `validateWindow` (SCRUM-124).
 *
 * This function is a deliberate duplicate of the backend's `createRequestBody` refine, so these
 * tests exist to pin the rule it mirrors — most of all that "after" is strict, since an off-by-one
 * here would let a same-day request through to a 400 the member cannot explain.
 */
import { describe, expect, it } from 'vitest';
import { validateWindow } from '../../../src/utils/requestWindow';

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
