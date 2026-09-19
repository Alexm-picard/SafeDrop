// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: approval queue wired to real GET/approve/deny endpoints (SCRUM-requests-approve, SCRUM-requests-deny, SCRUM-requests-list)
// Human Contributions: pending team review

/**
 * The approval queue: requests waiting on a decision, and a browsable history of the rest.
 *
 * Reachable only by APPROVER and ORG_ADMIN (see router.jsx's RequireRole), so this page always asks
 * for the organisation-wide view (`scope: 'org'`) rather than the caller's own requests — that
 * distinction is what keeps this page's data separate from MyRequestsPage's, even for an ORG_ADMIN
 * who could otherwise see both.
 *
 * The state filter defaults to PENDING, since deciding is the point of this page, but any state can
 * be selected to see where things stand. Approve/Deny only render for a PENDING row: checkout and
 * return — the other actions this same request list will eventually need — belong to a later ticket,
 * so every other state is shown read-only for now.
 */
import { useCallback, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useRequests } from '../hooks/useRequests';
import * as requestsApi from '../services/requests.api';
import { REQUEST_STATES } from '../utils/constants';
import { formatDate, humanize } from '../utils/format';

/**
 * Render the approval queue: a state filter, the matching requests, and approve/deny for the
 * PENDING ones.
 *
 * `busyId` disables a row's own buttons while its decision is in flight, so a double-click cannot
 * fire the same decision twice. `lastFailed` remembers which request and action failed, so
 * ErrorState's retry button replays exactly that decision rather than reloading the list.
 * @returns {JSX.Element}
 */
export function ApprovalQueuePage() {
  const [stateFilter, setStateFilter] = useState('PENDING');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [lastFailed, setLastFailed] = useState(null);

  const { status, data, error, reload } = useRequests({
    scope: 'org',
    state: stateFilter || undefined,
  });

  const decide = useCallback(
    async (id, action) => {
      setActionError(null);
      setBusyId(id);
      try {
        await (action === 'approve' ? requestsApi.approve(id) : requestsApi.deny(id));
        setLastFailed(null);
        reload();
      } catch (err) {
        setActionError(err);
        setLastFailed({ id, action });
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  return (
    <>
      <h1>Approval queue</h1>
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
      {actionError ? (
        <ErrorState
          error={actionError}
          title="Could not record that decision"
          onRetry={lastFailed ? () => decide(lastFailed.id, lastFailed.action) : undefined}
        />
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
              key: 'actions',
              header: 'Actions',
              render: (r) =>
                r.state === 'PENDING' ? (
                  <div className="actions">
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => decide(r.id, 'approve')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busyId === r.id}
                      onClick={() => decide(r.id, 'deny')}
                    >
                      Deny
                    </button>
                  </div>
                ) : (
                  <span className="meta">—</span>
                ),
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
