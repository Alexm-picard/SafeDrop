// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100%
// AI-Assisted Areas: tone maps for request-state and unit-status badges (UI rework)
// Human Contributions: pending team review

/**
 * Which colour family a status badge takes.
 *
 * The colour only repeats what the badge's words already say (WCAG 1.4.1); it lets a reader scan a
 * column for the rows that need them. Grouped by what the status asks of someone:
 *  - `warn`    — waiting on a person (a decision, a confirmation, a repair)
 *  - `danger`  — something has gone wrong (late, lost)
 *  - `info`    — in progress and on track
 *  - `ok`      — ready / finished well
 *  - `neutral` — closed with nothing to do
 *
 * A status not listed here falls back to `neutral`, so a state added on the backend still renders.
 */
export const REQUEST_STATE_TONE = Object.freeze({
  PENDING: 'warn',
  APPROVED: 'info',
  CHECKED_OUT: 'info',
  OVERDUE: 'danger',
  RETURN_PENDING: 'warn',
  RETURNED: 'ok',
  DENIED: 'neutral',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  LOST: 'danger',
});

export const UNIT_STATUS_TONE = Object.freeze({
  AVAILABLE: 'ok',
  REQUESTED: 'warn',
  HELD: 'info',
  OUT: 'info',
  MAINTENANCE: 'warn',
  RETIRED: 'neutral',
});
