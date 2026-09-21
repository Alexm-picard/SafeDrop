// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code for SCRUM-122)
// AI-Assisted Areas: tests for fieldErrorsOf, covering both API error shapes
// Human Contributions: pending team review
// Notes: Must be reviewed by the owning team member before merge.

/**
 * Tests for `fieldErrorsOf` (SCRUM-122).
 *
 * The helper exists because the backend reports field problems in two different shapes, and both
 * belong beside an input. These tests pin both, plus the precedence between them — a 400's per-field
 * list wins over a conflict's single `field`, since the list is the more specific answer.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/services/api';
import { fieldErrorsOf } from '../../../src/utils/formErrors';

/**
 * Build an ApiError carrying `details`, the way services/api.js does from a failed response.
 * @param {unknown} details
 * @param {string} [message]
 * @returns {ApiError}
 */
const apiError = (details, message = 'Conflict') =>
  new ApiError(409, 'CONFLICT', message, details, 'req-test');

describe('fieldErrorsOf', () => {
  it('flattens a 400’s per-field list', () => {
    const err = apiError([
      { path: 'name', message: 'Name is required' },
      { path: 'category', message: 'Category is required' },
    ]);
    expect(fieldErrorsOf(err)).toEqual({
      name: 'Name is required',
      category: 'Category is required',
    });
  });

  it('folds a conflict’s single { field } onto the error’s own message', () => {
    const err = apiError({ field: 'tag' }, 'A unit with this tag already exists');
    expect(fieldErrorsOf(err)).toEqual({ tag: 'A unit with this tag already exists' });
  });

  it('returns nothing for an error that names no field, so the caller falls back to a banner', () => {
    expect(fieldErrorsOf(apiError(undefined))).toEqual({});
    expect(fieldErrorsOf(apiError({ ticket: 'SCRUM-134' }))).toEqual({});
  });

  it('keeps the per-field message when both shapes name the same field', () => {
    const err = apiError([{ path: 'tag', message: 'Tag is too long' }], 'Duplicate tag');
    expect(fieldErrorsOf(err)).toEqual({ tag: 'Tag is too long' });
  });
});
