// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: approval queue (SCRUM-119, SCRUM-120); SCRUM-205 actions moved to the request detail page, every row links there; UI rework: requester/asset/unit names, state badges, state filter buttons, ?state= deep links; Overdue view uses the dashboard's past-due rule; SCRUM-241 redesign: the queue as a board by stage, approve/deny/handoff on the card (same actionsFor() rules as the request page), Everyone's/Mine switch
// Human Contributions: reviewed and approved by Amber Rastella (PR #7, 2026-09-18); latest changes reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL

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
 * SCRUM-241: the requests are a board, a column per stage. A card offers the one-click next steps —
 * approve, deny, record the handoff — and links to the request's page for the rest (returns need a
 * condition, a rejected return a reason). Both ask `actionsFor()`, so there is still one set of rules
 * for who sees which button.
 *
 * Each card names the requester, the asset and the unit tag (the API attaches them to every list item)
 * because those are what an approver decides on; the raw ids are not. The filter lives in the URL
 * (`?state=OVERDUE`), so the dashboard's tiles can link straight to the matching view and a filtered
 * queue survives a reload or a shared link.
 */
import { Link, useSearchParams } from 'react-router';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { RequestBoard } from '../components/RequestBoard';
import { useRequests } from '../hooks/useRequests';
import { ROUTES } from '../utils/constants';
import { humanize, pluralize } from '../utils/format';

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
          <h1>Requests</h1>
          <p className="subtitle">
            Every request in your organization, by where it is. Approve, deny and record handoffs on
            the card; open one for returns and its history.
          </p>
        </div>
        <div className="actions">
          <nav className="view-switch" aria-label="Whose requests">
            <Link to={ROUTES.approvals} aria-current="page">
              Everyone’s
            </Link>
            <Link to={ROUTES.myRequests}>Mine</Link>
          </nav>
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
        <section aria-labelledby="queue-heading">
          <div className="board-head">
            <h2 id="queue-heading">{listLabel}</h2>
            <span className="hint">{pluralize(data.total ?? data.items.length, 'request')}</span>
          </div>
          {data.items.length === 0 ? (
            <p className="empty-state">No requests match this filter.</p>
          ) : (
            <RequestBoard
              requests={data.items}
              showRequester
              onChanged={reload}
              onlyStates={stateFilter ? [isOverdueView ? 'OVERDUE' : stateFilter] : undefined}
            />
          )}
        </section>
      ) : null}
    </>
  );
}
