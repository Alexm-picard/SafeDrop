// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code against the SCRUM-143 tests)
// AI-Assisted Areas: the shared due badge rendered by MyRequestsPage and RequestDetailPage
// Human Contributions: reviewed and approved by Amber Rastella (PR #48, 2026-09-28); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: The green half of the Lab 3 red-green-refactor cycle for SCRUM-143; the tests were written
// first and watched to fail. Reviewed before merge; see Human Contributions.

/**
 * A request's deadline, at a glance (SCRUM-143).
 *
 * Shared by the two screens that show it rather than written twice, so a member who clicks a row to
 * reach the detail page cannot be told two different things about the same request.
 *
 * All the thinking is in `dueStatus`; this is only how it reaches the screen.
 */
import { dueStatus } from '../utils/dueStatus';

/**
 * Render the badge, or nothing at all.
 *
 * **The words carry the meaning and the colour only repeats it.** `data-tone` exists for the
 * stylesheet to key off, and the label says "Overdue by 2 days" in text, so anyone who cannot tell
 * the red one from the green one still reads the same message (WCAG 1.4.1). That is also what makes
 * it safe in a table cell: with the stylesheet stripped away the column still says something true.
 *
 * Returning `null` for a request with no deadline leaves an empty cell, which is what a pending
 * request should look like — a request that has not been handed over has no date to miss.
 *
 * @param {{ request: { state: string, dueAt: Date|string|null }, now?: Date }} props `now` is for
 *   tests and stays out of the pages, which want the current time
 * @returns {JSX.Element|null}
 */
export function DueBadge({ request, now }) {
  const status = dueStatus(request, now);
  if (!status) {
    return null;
  }
  return (
    <span className="due-badge" data-tone={status.tone}>
      {status.label}
    </span>
  );
}
