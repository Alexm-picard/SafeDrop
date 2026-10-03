// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: admin dashboard with stat tiles from GET /api/dashboard/summary; ErrorState + retry on failure (SCRUM-102);
//   pending/overdue tiles and the 30-day checkout activity chart (SCRUM-102); a Requested tile for reserved units;
//   UI rework: tiles grouped by purpose, each linking to the screen that answers it, quick actions
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The admin dashboard: the organisation's inventory at a glance (ORG_ADMIN only, SCRUM-102).
 *
 * Nine figures and one chart, from a single `GET /api/dashboard/summary`. One request rather than
 * one per number, so every tile on the screen describes the same moment.
 *
 * The tiles are grouped by what an admin came to find out — what needs them, what is out on loan,
 * what the inventory looks like — and each one links to the screen where its number can be acted on
 * (the approval queue already filtered to that state, or the catalogue). The link is the tile's
 * whole area, but its name is a short "View …" phrase, so a screen reader hears label, number, link.
 * Links into the queue name the request state they open ("View checked out"), matching the queue's
 * own filter buttons, so the words on both screens are the same.
 *
 * "Overdue" carries a danger style when it is not zero, and the label says "Overdue" either way, so
 * the alarm is never colour alone (NFR-12).
 */
import { Link } from 'react-router';
import { CheckoutActivityChart } from '../components/CheckoutActivityChart';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useDashboardSummary } from '../hooks/useDashboardSummary';
import { ROUTES } from '../utils/constants';
import { formatCount } from '../utils/format';

/** The approval queue filtered to one request state. */
const queue = (state) => `${ROUTES.approvals}?state=${state}`;

/**
 * One figure: a label, its count, and optionally where to go about it.
 *
 * `tone` is `'alert'` for a number that means someone has to do something — today, an overdue loan —
 * and `'attention'` for one that is routine work waiting (pending requests).
 * @param {{ label: string, value: number, tone?: 'default'|'alert'|'attention', to?: string, linkLabel?: string }} props
 * @returns {JSX.Element}
 */
function Stat({ label, value, tone = 'default', to, linkLabel }) {
  const className = [
    'stat',
    tone === 'alert' && 'stat--alert',
    tone === 'attention' && 'stat--attention',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{formatCount(value)}</dd>
      {to ? (
        <Link className="stat-link" to={to}>
          {linkLabel} <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Render the summary counts and the activity chart.
 *
 * Each group is a description list, so the figures are announced as label/value pairs rather than as
 * loose numbers. Every count goes through `formatCount`, which renders an em dash instead of `NaN` if
 * a field is ever missing.
 * @returns {JSX.Element}
 */
export function AdminDashboardPage() {
  const { status, data, error, reload } = useDashboardSummary();
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">Your organization&rsquo;s inventory and loans at a glance.</p>
        </div>
        <div className="actions">
          <Link className="button" to={ROUTES.approvals}>
            Review requests
          </Link>
          <Link className="button secondary" to={ROUTES.assetNew}>
            New asset
          </Link>
          <Link className="button secondary" to={ROUTES.users}>
            Manage users
          </Link>
        </div>
      </header>
      {status === 'loading' ? <LoadingState label="Loading inventory summary…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the summary" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <>
          <section aria-label="Inventory summary">
            <div className="dashboard-section">
              <h2 id="attention-heading">Needs attention</h2>
              <dl className="stat-grid" aria-labelledby="attention-heading">
                <Stat
                  label="Pending requests"
                  value={data.pendingRequests}
                  tone={data.pendingRequests > 0 ? 'attention' : 'default'}
                  to={queue('PENDING')}
                  linkLabel="View pending"
                />
                <Stat
                  label="Overdue"
                  value={data.overdue}
                  tone={data.overdue > 0 ? 'alert' : 'default'}
                  to={queue('OVERDUE')}
                  linkLabel="View overdue"
                />
                <Stat
                  label="On hold"
                  value={data.held}
                  to={queue('APPROVED')}
                  linkLabel="View approved"
                />
              </dl>
            </div>
            <div className="dashboard-section">
              <h2 id="inventory-heading">Inventory</h2>
              <dl className="stat-grid" aria-labelledby="inventory-heading">
                <Stat
                  label="Total assets"
                  value={data.totalAssets}
                  to={ROUTES.catalog}
                  linkLabel="Open catalog"
                />
                <Stat
                  label="Available"
                  value={data.available}
                  to={ROUTES.catalog}
                  linkLabel="Browse available"
                />
                <Stat
                  label="Checked out"
                  value={data.checkedOut}
                  to={queue('CHECKED_OUT')}
                  linkLabel="View checked out"
                />
                <Stat
                  label="Requested"
                  value={data.requested}
                  to={queue('PENDING')}
                  linkLabel="View pending"
                />
                {/* Its own tile rather than folded into Available: a unit in the shop is still owned
                    and still counted in Total assets, but it cannot be lent today (SCRUM-141). */}
                <Stat
                  label="In maintenance"
                  value={data.maintenance}
                  to={ROUTES.catalog}
                  linkLabel="Manage in catalog"
                />
                {/* No link: retired assets leave the catalogue, and their history is on each asset's
                    own page and in the audit log. */}
                <Stat label="Retired" value={data.retired} />
              </dl>
            </div>
          </section>
          <section className="dashboard-section" aria-labelledby="activity-heading">
            <h2 id="activity-heading">Checkout activity</h2>
            <CheckoutActivityChart activity={data.activity} />
          </section>
        </>
      ) : null}
    </>
  );
}
