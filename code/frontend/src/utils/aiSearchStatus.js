// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: the one-line status of AI search, shared by the AI search page and the Overview's alert (SCRUM-242)
// Human Contributions: feature choice and placement by Amber Rastella; reviewer recorded on the PR
// Notes: Thresholds are named constants so the team can tune them in one place.

/**
 * What an admin should take away from the search telemetry summary, in one line (SCRUM-242).
 *
 * The AI search page leads with this, and the Overview shows it only when `needsAttention` is true,
 * so the two can never disagree about whether something is wrong.
 *
 * "Needs attention" means something an admin can act on or should report:
 *
 * - **The AI keeps failing.** Searches fell back because Foundry did not answer, or answered in a
 *   shape the app cannot use, often enough to matter (`FAILING_RATE` of at least `MIN_SEARCHES`). A
 *   search switched off by configuration is not a failure: when every fallback is `disabled`, AI is off
 *   for the whole deployment, which an organisation's admin cannot change, so that is reported as a
 *   neutral fact rather than an alarm.
 * - **The catalogue has outgrown the AI.** Any search that reached the candidate cap means part of the
 *   catalogue was never considered (OD-10).
 */

/** Below this many searches, a high failure rate is a couple of unlucky searches, not a trend. */
export const MIN_SEARCHES = 5;

/** The share of searches that fell back because of a failure, at or above which it needs attention. */
export const FAILING_RATE = 0.2;

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

/**
 * `kind` names which case applied, for a caller that shows more than the one line.
 * @typedef {{ kind: 'none'|'off'|'failing'|'catalog'|'ok', tone: 'ok'|'warn'|'muted', title: string,
 *   detail: string, needsAttention: boolean }} AiSearchStatus
 */

/**
 * The status line for a telemetry summary.
 * @param {{ total: number, aiAssisted: number, fallbacks: { disabled: number, unavailable: number,
 *   contract: number }, candidateCapHits: number, candidateCap: number }} summary
 * @returns {AiSearchStatus}
 */
export function aiSearchStatus(summary) {
  const { total, aiAssisted, fallbacks, candidateCapHits, candidateCap } = summary;
  if (total === 0) {
    return {
      kind: 'none',
      tone: 'muted',
      title: 'No searches yet',
      detail: 'Figures appear here once members search the catalog.',
      needsAttention: false,
    };
  }
  if (fallbacks.disabled === total) {
    return {
      kind: 'off',
      tone: 'muted',
      title: 'AI search is switched off',
      detail:
        'Searches use plain text matching. AI search is turned on for the whole deployment, not per organization.',
      needsAttention: false,
    };
  }
  const failing = fallbacks.unavailable + fallbacks.contract;
  if (total >= MIN_SEARCHES && failing / total >= FAILING_RATE) {
    return {
      kind: 'failing',
      tone: 'warn',
      title: 'AI search is often falling back to text matching',
      detail: `${percent.format(failing / total)} of searches in the last 30 days could not be ranked by AI. Members still got text matches. If this continues, report it to whoever runs SafeDrop.`,
      needsAttention: true,
    };
  }
  if (candidateCapHits > 0) {
    return {
      kind: 'catalog',
      tone: 'warn',
      title: 'Your catalog is larger than AI search can review at once',
      detail: `AI search considers up to ${candidateCap} items per search, so some items were left out of ${candidateCapHits === 1 ? 'one search' : `${candidateCapHits} searches`}.`,
      needsAttention: true,
    };
  }
  return {
    kind: 'ok',
    tone: 'ok',
    title: 'AI search is working normally',
    detail: `${aiAssisted} of ${total} searches in the last 30 days were ranked by AI.`,
    needsAttention: false,
  };
}
