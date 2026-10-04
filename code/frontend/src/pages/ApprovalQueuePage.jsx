// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: approval queue (SCRUM-119, SCRUM-120); SCRUM-205 actions moved to the request detail page, every row links there
// Human Contributions: pending team review

/**
 * The approval queue: every request in the organisation an approver/admin may need to act on.
 *
 * Reachable only by APPROVER and ORG_ADMIN (see router.jsx's RequireRole), so this page always asks
 * for the organisation-wide view (`scope: 'org'`) rather than the caller's own requests — that
 * distinction is what keeps this page's data separate from MyRequestsPage's, even for an ORG_ADMIN
 * who could otherwise see both.
 *
 * The state filter defaults to PENDING, since deciding is the most common reason to open this page,
 * but any state can be selected — including RETURN_PENDING, the returns waiting to be confirmed
 * (SCRUM-205).
 *
 * The page offers no actions of its own. Each row links to the request's detail page, where
 * `actionsFor()` draws whatever this viewer may do next — approve, deny, record the handoff, record,
 * confirm or reject a return. Keeping them in one place means one set of rules for who sees which
 * button, rather than a second copy here that drifts from it.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useRequests } from '../hooks/useRequests';
import { REQUEST_STATES, ROUTES } from '../utils/constants';
import { formatDate, humanize } from '../utils/format';

/**
 * Render the approval queue: a state filter and the matching requests, each linking to its detail
 * page.
 * @returns {JSX.Element}
 */
export function ApprovalQueuePage() {
  const [stateFilter, setStateFilter] = useState('PENDING');

  const { status, data, error, reload } = useRequests({
    scope: 'org',
    state: stateFilter || undefined,
  });

  return (
    <>
      <h1>Approval queue</h1>
      <p className="hint">Open a request to act on it.</p>
      <form className="filters" aria-label="Filter requests" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="filter-state">State</label>
          <select
            id="filter-state"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">All</option>
            {REQUEST_STATES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
      </form>
      {status === 'loading' ? <LoadingState label="Loading requests…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the queue" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <DataTable
          caption="Requests"
          columns={[
            { key: 'state', header: 'State', render: (r) => humanize(r.state) },
            { key: 'requester', header: 'Requester', render: (r) => r.requesterId },
            { key: 'from', header: 'Needed from', render: (r) => formatDate(r.neededFrom) },
            { key: 'to', header: 'Needed until', render: (r) => formatDate(r.neededTo) },
            {
              key: 'open',
              header: 'Request',
              render: (r) => <Link to={ROUTES.request(r.id)}>Open</Link>,
            },
          ]}
          rows={data.items}
          getRowId={(r) => r.id}
          emptyMessage="No requests match this filter."
        />
      ) : null}
    </>
  );
}
