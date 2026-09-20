// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: request detail screen: summary, timeline, and actions driven by the state machine rather than hard-coded state checks
// Human Contributions: pending team review
// Notes: Written for SCRUM-123. Must be reviewed and tested by the owning team member before merge.

/**
 * One checkout request, in full (SCRUM-123).
 *
 * The screen the workflow needed and did not have: the list shows state, the queue shows what is
 * waiting on an approver, and neither has anywhere to put cancel, handoff or return — nor anywhere
 * to see what has already happened to a request.
 *
 * **Which buttons appear is decided by `actionsFor()`**, which asks the state machine what the
 * request may do next and the permission matrix who may do it. That is the difference between a
 * screen that stays correct when the workflow changes and a pile of `state === 'PENDING' &&
 * role === 'APPROVER'` conditions that quietly rot. The API enforces both regardless (SR-1).
 *
 * **A request the viewer may not see is a 404**, exactly as the API answers: another organisation's
 * id and another member's id are indistinguishable from an id that never existed, so neither can be
 * used to discover that a request exists (SR-2). The page renders the same not-found panel for all
 * three rather than an error dump.
 */
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../hooks/useAuth';
import { useRequest } from '../hooks/useRequests';
import { errorMessage, isApiError } from '../services/api';
import * as requestsApi from '../services/requests.api';
import { ROUTES, UNIT_CONDITIONS } from '../utils/constants';
import { formatDate, humanize } from '../utils/format';
import { actionsFor } from '../utils/requestState';

/**
 * Send one action to the API.
 * @param {string} key one of the action keys from `actionsFor`
 * @param {string} id request id
 * @param {{ condition?: string }} [payload] only meaningful for `return`
 * @returns {Promise<unknown>}
 */
function callAction(key, id, payload) {
  switch (key) {
    case 'approve':
      return requestsApi.approve(id);
    case 'deny':
      return requestsApi.deny(id);
    case 'cancel':
      return requestsApi.cancel(id);
    case 'checkout':
      return requestsApi.checkout(id);
    case 'return':
      return requestsApi.returnUnit(id, payload);
    default:
      return Promise.reject(new Error(`unknown action ${key}`));
  }
}

/**
 * What happened to this request, oldest first.
 *
 * The API builds the list from the request's own timestamps, so an empty one is impossible for a
 * real request — but a defensive fallback beats an empty `<ol>` if the shape ever changes.
 * @param {{ timeline: Array<{ at: string, event: string }> }} props
 * @returns {JSX.Element}
 */
function Timeline({ timeline }) {
  if (!timeline?.length) {
    return <p className="hint">Nothing has happened to this request yet.</p>;
  }
  return (
    <ol className="timeline" aria-label="Request history">
      {timeline.map((entry) => (
        <li key={`${entry.event}-${entry.at}`}>
          <strong>{humanize(entry.event)}</strong> <span>{formatDate(entry.at)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Render the request, or the not-found panel, or the failure.
 *
 * `condition` is held here rather than in the action loop because only the return action uses it,
 * and the API requires it: a return with no condition recorded tells a later reader nothing about
 * what came back.
 * @returns {JSX.Element}
 */
export function RequestDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { status, data, error, reload } = useRequest(id);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [condition, setCondition] = useState(UNIT_CONDITIONS[1] ?? 'GOOD');

  const run = useCallback(
    async (key) => {
      setBusy(key);
      setActionError(null);
      try {
        await callAction(key, id, key === 'return' ? { condition } : undefined);
        reload();
      } catch (err) {
        // A 409 from the state machine is the interesting one: the request moved under us, or the
        // transition was never legal. The API's message says which, so it is shown verbatim.
        setActionError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [condition, id, reload],
  );

  if (status === 'loading') {
    return <LoadingState label="Loading request…" />;
  }

  if (status === 'error') {
    if (isApiError(error) && error.status === 404) {
      return (
        <section>
          <h1>Request not found</h1>
          <p>
            This request does not exist, or it is not yours to see.{' '}
            <Link to={ROUTES.myRequests}>Back to my requests</Link>
          </p>
        </section>
      );
    }
    return <ErrorState error={error} title="That request could not be loaded" onRetry={reload} />;
  }

  const { request, asset, unit, requester, decidedBy, timeline } = data;
  const actions = actionsFor(request, { role: user?.role, userId: user?.id });
  const offersReturn = actions.some((action) => action.key === 'return');

  return (
    <section>
      <h1>{asset ? asset.name : 'Request'}</h1>
      <p className="hint">
        <Link to={ROUTES.myRequests}>My requests</Link>
      </p>

      <dl className="detail" aria-label="Request details">
        <dt>State</dt>
        <dd>{humanize(request.state)}</dd>
        <dt>Requested by</dt>
        <dd>{requester ? `${requester.name} (${requester.email})` : 'Unknown'}</dd>
        <dt>Unit</dt>
        <dd>{unit ? `${unit.tag}${unit.serial ? ` · ${unit.serial}` : ''}` : 'Unknown'}</dd>
        <dt>Needed</dt>
        <dd>
          {formatDate(request.neededFrom)} – {formatDate(request.neededTo)}
        </dd>
        {request.dueAt ? (
          <>
            <dt>Due back</dt>
            <dd>{formatDate(request.dueAt)}</dd>
          </>
        ) : null}
        {decidedBy ? (
          <>
            <dt>Decided by</dt>
            <dd>{decidedBy.name}</dd>
          </>
        ) : null}
        {request.note ? (
          <>
            <dt>Note</dt>
            <dd>{request.note}</dd>
          </>
        ) : null}
        {request.decisionNote ? (
          <>
            <dt>Decision note</dt>
            <dd>{request.decisionNote}</dd>
          </>
        ) : null}
      </dl>

      <h2>History</h2>
      <Timeline timeline={timeline} />

      <h2>Actions</h2>
      {actionError ? (
        <div role="alert" className="alert">
          {actionError}
        </div>
      ) : null}
      {actions.length === 0 ? (
        <p className="hint">There is nothing to do on this request.</p>
      ) : (
        <div className="actions">
          {offersReturn ? (
            <label>
              Returned condition
              <select value={condition} onChange={(event) => setCondition(event.target.value)}>
                {UNIT_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={action.key === 'deny' || action.key === 'cancel' ? 'secondary' : undefined}
              disabled={busy !== null}
              onClick={() => run(action.key)}
            >
              {busy === action.key ? 'Working…' : action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
