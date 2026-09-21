// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: admin dashboard with stat tiles from GET /api/dashboard/summary; ErrorState + retry on failure (SCRUM-102);
//   pending/overdue tiles and the 30-day checkout activity chart (SCRUM-102); a Requested tile for reserved units
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The admin dashboard: the organisation's inventory at a glance (ORG_ADMIN only, SCRUM-102).
 *
 * Eight figures and one chart, from a single `GET /api/dashboard/summary`. One request rather than
 * one per number, so every tile on the screen describes the same moment.
 *
 * The tiles are ordered by what an admin came to find out: what we own, what is out, what is late,
 * what is waiting on them — then the rest of the breakdown. "Overdue" carries a danger style when it
 * is not zero, and the label says "Overdue" either way, so the alarm is never colour alone (NFR-12).
 */
import { CheckoutActivityChart } from '../components/CheckoutActivityChart';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useDashboardSummary } from '../hooks/useDashboardSummary';
import { formatCount } from '../utils/format';

/**
 * One figure: a label and its count.
 *
 * `tone` is `'alert'` for a number that means someone has to do something — today, an overdue loan.
 * @param {{ label: string, value: number, tone?: 'default'|'alert' }} props
 * @returns {JSX.Element}
 */
function Stat({ label, value, tone = 'default' }) {
  return (
    <div className={tone === 'alert' ? 'stat stat--alert' : 'stat'}>
      <dt>{label}</dt>
      <dd>{formatCount(value)}</dd>
    </div>
  );
}

/**
 * Render the summary counts and the activity chart.
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
        <>
          <dl className="stat-grid" aria-label="Inventory summary">
            <Stat label="Total assets" value={data.totalAssets} />
            <Stat label="Checked out" value={data.checkedOut} />
            <Stat
              label="Overdue"
              value={data.overdue}
              tone={data.overdue > 0 ? 'alert' : 'default'}
            />
            <Stat label="Pending requests" value={data.pendingRequests} />
            <Stat label="Available" value={data.available} />
            <Stat label="On hold" value={data.held} />
            <Stat label="Requested" value={data.requested} />
            <Stat label="Retired" value={data.retired} />
          </dl>
          <section aria-labelledby="activity-heading">
            <h2 id="activity-heading">Checkout activity</h2>
            <CheckoutActivityChart activity={data.activity} />
          </section>
        </>
      ) : null}
    </>
  );
}
