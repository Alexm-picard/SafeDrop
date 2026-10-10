// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: admin dashboard with stat tiles from GET /api/dashboard/summary; ErrorState + retry on failure (SCRUM-102);
//   pending/overdue tiles and the 30-day checkout activity chart (SCRUM-102); a Requested tile for reserved units;
//   UI rework: tiles grouped by purpose, each linking to the screen that answers it, quick actions;
//   SCRUM-241: the Overview — an attention strip with the inventory as one stacked bar, the loan timeline, the activity chart
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The admin dashboard, titled Overview: the organisation's inventory at a glance (ORG_ADMIN only,
 * SCRUM-102).
 *
 * SCRUM-241: the figures sit in one strip under the title — the three that ask the admin to act, then
 * the inventory as a single stacked bar with its counts as the legend — and below it the loan timeline
 * (every live request on its dates, against today) and the checkout chart.
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
import { LoanTimeline } from '../components/LoanTimeline';
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
 * `swatch` is the inventory legend's colour key, matching its segment of the stacked bar.
 * @param {{ label: string, value: number, tone?: 'default'|'alert'|'attention', to?: string,
 *   linkLabel?: string, swatch?: string }} props
 * @returns {JSX.Element}
 */
function Stat({ label, value, tone = 'default', to, linkLabel, swatch }) {
  const className = [
    'stat',
    tone === 'alert' && 'stat--alert',
    tone === 'attention' && 'stat--attention',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      <dt>
        {swatch ? <span className="swatch" data-swatch={swatch} aria-hidden="true" /> : null}
        {label}
      </dt>
      <dd>{formatCount(value)}</dd>
      {to ? (
        <Link className="stat-link" to={to}>
          {linkLabel}
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
  const segments = data
    ? [
        ['available', data.available],
        ['out', data.checkedOut],
        ['requested', data.requested],
        ['maintenance', data.maintenance],
        ['retired', data.retired],
      ].filter(([, n]) => n > 0)
    : [];
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Overview</h1>
          <p className="subtitle">Your organization&rsquo;s equipment and loans at a glance.</p>
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
          <section className="strip" aria-labelledby="attention-heading">
            <h2 id="attention-heading" className="visually-hidden">
              Needs attention
            </h2>
            <dl className="strip-attention" aria-label="Needs attention">
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
            <div className="strip-inventory">
              <h2 id="inventory-heading" className="strip-title">
                Inventory
              </h2>
              <div className="stackbar" aria-hidden="true">
                {segments.map(([key, n]) => (
                  <span key={key} data-swatch={key} style={{ flexGrow: n }} />
                ))}
              </div>
              <dl className="legend" aria-label="Inventory summary">
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
                  swatch="available"
                />
                <Stat
                  label="Checked out"
                  value={data.checkedOut}
                  to={queue('CHECKED_OUT')}
                  linkLabel="View checked out"
                  swatch="out"
                />
                <Stat
                  label="Requested"
                  value={data.requested}
                  to={queue('PENDING')}
                  linkLabel="View pending"
                  swatch="requested"
                />
                {/* Its own figure rather than folded into Available: a unit in the shop is still
                    owned and still counted in Total assets, but it cannot be lent today (SCRUM-141). */}
                <Stat
                  label="In maintenance"
                  value={data.maintenance}
                  to={ROUTES.catalog}
                  linkLabel="Manage in catalog"
                  swatch="maintenance"
                />
                {/* No link: retired assets leave the catalogue, and their history is on each asset's
                    own page and in the audit log. */}
                <Stat label="Retired" value={data.retired} swatch="retired" />
              </dl>
            </div>
          </section>
          <LoanTimeline />
          <section className="card activity-card" aria-labelledby="activity-heading">
            <h2 id="activity-heading">Checkout activity</h2>
            <CheckoutActivityChart activity={data.activity} />
          </section>
        </>
      ) : null}
    </>
  );
}
