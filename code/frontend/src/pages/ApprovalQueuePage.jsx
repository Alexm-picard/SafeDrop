// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: approval queue wired to approve/deny/checkout/return (SCRUM-requests-approve, SCRUM-requests-deny, SCRUM-requests-checkout, SCRUM-requests-return, SCRUM-requests-list)
// Human Contributions: pending team review

/**
 * The approval queue: every action an approver/admin takes on a request lives here.
 *
 * Reachable only by APPROVER and ORG_ADMIN (see router.jsx's RequireRole), so this page always asks
 * for the organisation-wide view (`scope: 'org'`) rather than the caller's own requests — that
 * distinction is what keeps this page's data separate from MyRequestsPage's, even for an ORG_ADMIN
 * who could otherwise see both.
 *
 * The state filter defaults to PENDING, since deciding is the most common reason to open this page,
 * but any state can be selected to see where things stand. Which action shows depends entirely on the
 * row's own state — approve/deny for PENDING, check out for APPROVED, return (with an optional
 * condition) for CHECKED_OUT — since a borrower never calls checkout/return themselves (SR-1):
 * `requests:handoff` is APPROVER/ORG_ADMIN only, so this page is the only place those transitions
 * happen at all.
 */
import { useCallback, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useRequests } from '../hooks/useRequests';
import * as requestsApi from '../services/requests.api';
import { REQUEST_STATES, UNIT_CONDITIONS } from '../utils/constants';
import { formatDate, humanize } from '../utils/format';

/**
 * Call the right endpoint for `action`.
 * @param {string} id
 * @param {'approve'|'deny'|'checkout'|'return'} action
 * @param {{ condition?: string }} [payload] only meaningful for `return`
 * @returns {Promise<object>}
 */
function runAction(id, action, payload) {
  switch (action) {
    case 'approve':
      return requestsApi.approve(id);
    case 'deny':
      return requestsApi.deny(id);
    case 'checkout':
      return requestsApi.checkout(id);
    case 'return':
      return requestsApi.returnUnit(id, payload);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Render the approval queue: a state filter, the matching requests, and whichever action each row's
 * state allows.
 *
 * `busyId` disables a row's own buttons while its action is in flight, so a double-click cannot fire
 * the same action twice. `lastFailed` remembers the request, action and payload that failed, so
 * ErrorState's retry button replays exactly that action rather than reloading the list.
 * `returnConditions` holds the condition picked for each CHECKED_OUT row's return form, keyed by
 * request id, so choosing one row's condition never affects another's.
 * @returns {JSX.Element}
 */
export function ApprovalQueuePage() {
  const [stateFilter, setStateFilter] = useState('PENDING');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [lastFailed, setLastFailed] = useState(null);
  const [returnConditions, setReturnConditions] = useState({});

  const { status, data, error, reload } = useRequests({
    scope: 'org',
    state: stateFilter || undefined,
  });

  const decide = useCallback(
    async (id, action, payload) => {
      setActionError(null);
      setBusyId(id);
      try {
        await runAction(id, action, payload);
        setLastFailed(null);
        reload();
      } catch (err) {
        setActionError(err);
        setLastFailed({ id, action, payload });
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  const setReturnCondition = useCallback((id, condition) => {
    setReturnConditions((prev) => ({ ...prev, [id]: condition }));
  }, []);

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
          title="Could not complete that action"
          onRetry={
            lastFailed
              ? () => decide(lastFailed.id, lastFailed.action, lastFailed.payload)
              : undefined
          }
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
              render: (r) => {
                if (r.state === 'PENDING') {
                  return (
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
                  );
                }
                if (r.state === 'APPROVED') {
                  return (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => decide(r.id, 'checkout')}
                    >
                      Check out
                    </button>
                  );
                }
                if (r.state === 'CHECKED_OUT') {
                  const condition = returnConditions[r.id] ?? '';
                  return (
                    <div className="actions">
                      <select
                        aria-label="Returned condition"
                        value={condition}
                        disabled={busyId === r.id}
                        onChange={(e) => setReturnCondition(r.id, e.target.value)}
                      >
                        <option value="">Condition unchanged</option>
                        {UNIT_CONDITIONS.map((c) => (
                          <option key={c} value={c}>
                            {humanize(c)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => decide(r.id, 'return', condition ? { condition } : {})}
                      >
                        Return
                      </button>
                    </div>
                  );
                }
                return <span className="meta">—</span>;
              },
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
