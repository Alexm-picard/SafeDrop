// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: approval queue (SCRUM-119, SCRUM-120); SCRUM-205 actions moved to the request detail page, every row links there; UI rework: requester/asset/unit names, state badges, state filter buttons, ?state= deep links; Overdue view uses the dashboard's past-due rule
// Human Contributions: pending team review

/**
 * The approval queue: every request in the organisation an approver/admin may need to act on.
 *
 * Reachable only by APPROVER and ORG_ADMIN (see router.jsx's RequireRole), so this page always asks
 * for the organisation-wide view (`scope: 'org'`) rather than the caller's own requests — that
 * distinction is what keeps this page's data separate from MyRequestsPage's, even for an ORG_ADMIN
 * who could otherwise see both.
 *
 * The state filter defaults to All, so the page opens on the whole picture; any single state can be
 * selected — including PENDING for deciding, and RETURN_PENDING, the returns waiting to be confirmed
 * (SCRUM-205).
 *
 * The page offers no actions of its own. Each row links to the request's detail page, where
 * `actionsFor()` draws whatever this viewer may do next — approve, deny, record the handoff, record,
 * confirm or reject a return. Keeping them in one place means one set of rules for who sees which
 * button, rather than a second copy here that drifts from it.
 *
 * Each row names the requester, the asset and the unit tag (the API attaches them to every list item)
 * because those are what an approver decides on; the raw ids are not. The filter lives in the URL
 * (`?state=OVERDUE`), so the dashboard's tiles can link straight to the matching view and a filtered
 * queue survives a reload or a shared link.
 */
import { Link, useSearchParams } from 'react-router';
import { DataTable } from '../components/DataTable';
import { DueBadge } from '../components/DueBadge';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';
import { useRequests } from '../hooks/useRequests';
import { ROUTES } from '../utils/constants';
import { formatDate, humanize, pluralize } from '../utils/format';

/** The state the queue opens on when the URL names none: `''` is All. */
const DEFAULT_STATE = '';

/**
 * The queue's filter: one button per state, labelled with the state's own name (the same words the
 * badges and the dashboard use), ordered by what needs someone first (the open states), then the
 * closed ones, then everything. Every state in REQUEST_STATES is here, so no view is unreachable.
 */
const QUICK_FILTERS = Object.freeze([
  ...[
    'PENDING',
    'APPROVED',
    'CHECKED_OUT',
    'OVERDUE',
    'RETURN_PENDING',
    'RETURNED',
    'DENIED',
    'CANCELLED',
    'EXPIRED',
    'LOST',
  ].map((state) => ({ state, label: humanize(state) })),
  { state: '', label: 'All' },
]);
/**
 * Render the approval queue: a state filter and the matching requests, each linking to its detail
 * page.
 *
 * The table stays on screen while a new filter loads (the gate is `data`, not the status), so
 * switching views does not flash the page empty.
 * @returns {JSX.Element}
 */
export function ApprovalQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // No parameter means the default (All); `?state=` (empty) also means All.
  const stateFilter = searchParams.has('state') ? (searchParams.get('state') ?? '') : DEFAULT_STATE;
  const setStateFilter = (next) => setSearchParams({ state: next }, { replace: true });

  // "Overdue" means late and not yet back — the dashboard's definition — not only the requests whose
  // stored state has already been moved to OVERDUE. Those are moved only when mark-overdue runs, so
  // filtering on the state alone would miss loans still marked Checked out past their due date.
  const isOverdueView = stateFilter === 'OVERDUE';
  const { status, data, error, reload } = useRequests({
    scope: 'org',
    state: isOverdueView ? undefined : stateFilter || undefined,
    overdue: isOverdueView,
  });

  const quick = QUICK_FILTERS.find((f) => f.state === stateFilter);
  const listLabel =
    stateFilter === '' ? 'All requests' : quick ? quick.label : humanize(stateFilter);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Approval queue</h1>
          <p className="subtitle">
            Requests across your organization. Open one to approve, deny, or record a handoff.
          </p>
        </div>
      </header>
      <form className="filters" aria-label="Filter requests" onSubmit={(e) => e.preventDefault()}>
        <ul className="chips" aria-label="State">
          {QUICK_FILTERS.map((f) => (
            <li key={f.state || 'all'}>
              <button
                type="button"
                className="chip"
                aria-pressed={stateFilter === f.state}
                onClick={() => setStateFilter(f.state)}
              >
                {f.label}
              </button>
            </li>
          ))}
        </ul>
      </form>
      {status === 'loading' && !data ? <LoadingState label="Loading requests…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the queue" onRetry={reload} />
      ) : null}
      {status !== 'error' && data ? (
        <section className="panel" aria-labelledby="queue-heading">
          <div className="panel-header">
            <h2 id="queue-heading">{listLabel}</h2>
            <span className="hint">{pluralize(data.total ?? data.items.length, 'request')}</span>
          </div>
          <DataTable
            caption="Requests"
            hideCaption
            columns={[
              {
                key: 'requester',
                header: 'Requester',
                render: (r) =>
                  r.requester ? (
                    <>
                      <span className="cell-primary">{r.requester.name}</span>
                      <span className="cell-secondary">{r.requester.email}</span>
                    </>
                  ) : (
                    <span className="cell-secondary">Unknown user</span>
                  ),
              },
              {
                key: 'asset',
                header: 'Asset',
                render: (r) => (
                  <>
                    {r.asset ? (
                      <Link className="cell-primary" to={ROUTES.asset(r.asset.id)}>
                        {r.asset.name}
                      </Link>
                    ) : (
                      <span className="cell-secondary">Unknown asset</span>
                    )}
                    {r.unit ? (
                      <span className="cell-secondary">
                        Unit <span className="tag">{r.unit.tag}</span>
                      </span>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'window',
                header: 'Needed',
                render: (r) => (
                  <>
                    <span className="cell-primary">{formatDate(r.neededFrom)}</span>
                    <span className="cell-secondary">until {formatDate(r.neededTo)}</span>
                  </>
                ),
              },
              {
                key: 'state',
                header: 'State',
                render: (r) => (
                  <>
                    <StatusBadge value={r.state}>
                      {humanize(r.state)}
                      {r.autoApproved && r.state === 'APPROVED' ? ' (automatic)' : ''}
                    </StatusBadge>
                    <span className="cell-secondary">
                      <DueBadge request={r} />
                    </span>
                  </>
                ),
              },
              {
                key: 'open',
                header: 'Request',
                className: 'numeric',
                render: (r) => (
                  <Link className="button secondary small" to={ROUTES.request(r.id)}>
                    Open
                  </Link>
                ),
              },
            ]}
            rows={data.items}
            getRowId={(r) => r.id}
            emptyMessage="No requests match this filter."
          />
        </section>
      ) : null}
    </>
  );
}
