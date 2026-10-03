// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: request detail screen: summary, timeline, and actions driven by the state machine rather than hard-coded state checks; SCRUM-148 auto-approved label; SCRUM-205 borrower pickup, start/confirm/reject return; every approver action lives here (the approval queue links in)
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
 *
 * **Custody confirmation (SCRUM-205).** The borrower records their own pickup ("I've picked it up")
 * and starts their own return, reporting the condition. Someone else confirms the return with the
 * condition they received, or rejects it with a reason. Whether *this* viewer may confirm comes from
 * the API (`canConfirmReturn`), because only the server knows whether a requester is the
 * organisation's only confirmer.
 */
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { DueBadge } from '../components/DueBadge';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../hooks/useAuth';
import { useRequest } from '../hooks/useRequests';
import { errorMessage, isApiError } from '../services/api';
import * as requestsApi from '../services/requests.api';
import { ROLES, ROUTES, UNIT_CONDITIONS } from '../utils/constants';
import { formatDate, humanize } from '../utils/format';
import { actionsFor } from '../utils/requestState';

/**
 * Send one action to the API.
 * @param {string} key one of the action keys from `actionsFor`
 * @param {string} id request id
 * @param {{ condition?: string, note?: string, reason?: string }} [payload] the form values the
 *   return actions need: a condition for `return` and `initiateReturn`, a reason for `rejectReturn`
 * @returns {Promise<unknown>}
 */
function callAction(key, id, payload = {}) {
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
      return requestsApi.returnUnit(id, { condition: payload.condition });
    case 'initiateReturn':
      return requestsApi.initiateReturn(id, { condition: payload.condition, note: payload.note });
    case 'rejectReturn':
      return requestsApi.rejectReturn(id, payload.reason);
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

/** The condition a return form starts on when nothing better is known. */
const DEFAULT_CONDITION = UNIT_CONDITIONS[1] ?? 'GOOD';

/**
 * Render the request, or the not-found panel, or the failure.
 *
 * The return forms' values are held here rather than in the action loop because only the return
 * actions use them. `receivedCondition` starts empty and falls back to what the borrower reported, so
 * a confirmer who agrees just presses Confirm, and one who disagrees changes it.
 * @returns {JSX.Element}
 */
export function RequestDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { status, data, error, reload } = useRequest(id);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [receivedCondition, setReceivedCondition] = useState(null);
  const [reportedCondition, setReportedCondition] = useState(DEFAULT_CONDITION);
  const [reportedNote, setReportedNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const condition = receivedCondition ?? data?.request?.reportedCondition ?? DEFAULT_CONDITION;

  const run = useCallback(
    async (key) => {
      setBusy(key);
      setActionError(null);
      try {
        await callAction(key, id, {
          condition: key === 'initiateReturn' ? reportedCondition : condition,
          note: reportedNote,
          reason: rejectReason,
        });
        setReceivedCondition(null);
        setRejectReason('');
        reload();
      } catch (err) {
        // A 409 from the state machine is the interesting one: the request moved under us, or the
        // transition was never legal. The API's message says which, so it is shown verbatim.
        setActionError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [condition, id, rejectReason, reload, reportedCondition, reportedNote],
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

  const { request, asset, unit, requester, decidedBy, timeline, canConfirmReturn } = data;
  const actions = actionsFor(request, { role: user?.role, userId: user?.id, canConfirmReturn });
  const offers = (key) => actions.some((action) => action.key === key);
  const isRequester = Boolean(user?.id) && user.id === String(request.requesterId);
  const pendingReturn = request.state === 'RETURN_PENDING';

  return (
    <section>
      <h1>{asset ? asset.name : 'Request'}</h1>
      <p className="hint">
        <Link to={ROUTES.myRequests}>My requests</Link>
        {user?.role === ROLES.APPROVER || user?.role === ROLES.ORG_ADMIN ? (
          <>
            {' · '}
            <Link to={ROUTES.approvals}>Approval queue</Link>
          </>
        ) : null}
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
            <dd>
              {formatDate(request.dueAt)} <DueBadge request={request} />
            </dd>
          </>
        ) : null}
        {decidedBy ? (
          <>
            <dt>Decided by</dt>
            <dd>{decidedBy.name}</dd>
          </>
        ) : null}
        {/* SCRUM-148: no person decided this one, so say so instead of leaving the row out. */}
        {request.autoApproved ? (
          <>
            <dt>Decided by</dt>
            <dd>Approved automatically by your organization’s rules</dd>
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
        {/* SCRUM-205: what the borrower said when they started the return. */}
        {request.reportedCondition ? (
          <>
            <dt>Reported condition</dt>
            <dd>{humanize(request.reportedCondition)}</dd>
          </>
        ) : null}
        {request.reportedNote ? (
          <>
            <dt>Return note</dt>
            <dd>{request.reportedNote}</dd>
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
      {pendingReturn && isRequester ? (
        <p className="hint" role="status">
          Waiting for someone else to confirm this return. You are responsible for the item until
          they do.
        </p>
      ) : null}
      {actions.length === 0 ? (
        pendingReturn && isRequester ? null : (
          <p className="hint">There is nothing to do on this request.</p>
        )
      ) : (
        <div className="actions">
          {offers('initiateReturn') ? (
            <>
              <label>
                Condition you are returning it in
                <select
                  value={reportedCondition}
                  onChange={(event) => setReportedCondition(event.target.value)}
                >
                  {UNIT_CONDITIONS.map((value) => (
                    <option key={value} value={value}>
                      {humanize(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note (optional)
                <input
                  type="text"
                  maxLength={1000}
                  value={reportedNote}
                  onChange={(event) => setReportedNote(event.target.value)}
                />
              </label>
            </>
          ) : null}
          {offers('return') ? (
            <label>
              {pendingReturn ? 'Condition received' : 'Returned condition'}
              <select
                value={condition}
                onChange={(event) => setReceivedCondition(event.target.value)}
              >
                {UNIT_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {offers('rejectReturn') ? (
            <label>
              Reason for rejecting
              <input
                type="text"
                maxLength={1000}
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
              />
            </label>
          ) : null}
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={
                action.key === 'deny' || action.key === 'cancel' || action.key === 'rejectReturn'
                  ? 'secondary'
                  : undefined
              }
              disabled={
                busy !== null || (action.key === 'rejectReturn' && rejectReason.trim() === '')
              }
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
