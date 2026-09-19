// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: admin dashboard with stat tiles from GET /api/dashboard/summary; ErrorState + retry on failure (SCRUM-103)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The admin dashboard: inventory counts at a glance (ORG_ADMIN only).
 *
 * The one screen whose data path is complete end to end in Iteration 1 — hook, API, service and
 * repository — so it doubles as the proof that the whole stack works.
 */
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useDashboardSummary } from '../hooks/useDashboardSummary';
import { formatCount } from '../utils/format';
/**
 * Render the summary counts.
 *
 * Marked up as a description list with an `aria-label`, so the figures are announced as label/value
 * pairs rather than as loose numbers. Every count goes through `formatCount`, which renders an em
 * dash instead of `NaN` if a field is ever missing.
 * @returns {JSX.Element}
 */
export function AdminDashboardPage() {
  const { status, data, error, reload } = useDashboardSummary();
  return (
    <>
      <h1>Dashboard</h1>
      {status === 'loading' ? <LoadingState label="Loading inventory summary…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the summary" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <dl className="stat-grid" aria-label="Inventory summary">
          <div className="stat">
            <dt>Total assets</dt>
            <dd>{formatCount(data.totalAssets)}</dd>
          </div>
          <div className="stat">
            <dt>Checked out</dt>
            <dd>{formatCount(data.checkedOut)}</dd>
          </div>
          <div className="stat">
            <dt>Available</dt>
            <dd>{formatCount(data.available)}</dd>
          </div>
          <div className="stat">
            <dt>On hold</dt>
            <dd>{formatCount(data.held)}</dd>
          </div>
          <div className="stat">
            <dt>Retired</dt>
            <dd>{formatCount(data.retired)}</dd>
          </div>
        </dl>
      ) : null}
    </>
  );
}
