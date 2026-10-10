// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~95%
// AI-Assisted Areas: SCRUM-241 redesign: requests as a board with a column per stage, and the one-click next steps on each card
// Human Contributions: reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Which buttons a card offers comes from actionsFor() in utils/requestState.js, the same rules the request page uses; the API enforces them regardless (SR-1).

/**
 * Requests as a board: one column per stage — waiting for a decision, ready for pickup, out on loan,
 * done — and a card per request.
 *
 * **The next step is on the card when it needs nothing typed.** Approve, deny, record the handoff (or
 * "I've picked it up") and cancel are one click, so they are offered here; the steps that need a
 * condition or a reason (returns, confirming or rejecting a return) stay on the request's own page,
 * which every card links to. Both places ask `actionsFor()` which actions this viewer has, so the
 * rules live in one place and cannot drift apart.
 *
 * A card names the asset and unit, the requester (on the organisation-wide board), the dates, the
 * state and, for a loan, the due badge.
 */
import { useCallback, useId, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { errorMessage } from '../services/api';
import * as requestsApi from '../services/requests.api';
import { ROUTES } from '../utils/constants';
import { dueStatus } from '../utils/dueStatus';
import { formatDateOnly, humanize } from '../utils/format';
import { actionsFor } from '../utils/requestState';
import { DueBadge } from './DueBadge';
import { StatusBadge } from './StatusBadge';

/** The board's columns, left to right, and which states belong in each. */
const BOARD_COLUMNS = Object.freeze([
  Object.freeze({
    key: 'waiting',
    title: 'Waiting for a decision',
    states: Object.freeze(['PENDING']),
    empty: 'Nothing waiting.',
  }),
  Object.freeze({
    key: 'ready',
    title: 'Ready for pickup',
    states: Object.freeze(['APPROVED']),
    empty: 'Nothing to hand over.',
  }),
  Object.freeze({
    key: 'out',
    title: 'Out on loan',
    states: Object.freeze(['CHECKED_OUT', 'OVERDUE', 'RETURN_PENDING']),
    empty: 'Nothing out on loan.',
  }),
  Object.freeze({
    key: 'done',
    title: 'Done',
    states: Object.freeze(['RETURNED', 'DENIED', 'CANCELLED', 'EXPIRED', 'LOST']),
    empty: 'Nothing finished yet.',
  }),
]);

/** The actions a card offers itself: the ones that need nothing typed. */
const CARD_ACTIONS = Object.freeze(['approve', 'deny', 'checkout', 'cancel']);

const CALLS = Object.freeze({
  approve: requestsApi.approve,
  deny: requestsApi.deny,
  checkout: requestsApi.checkout,
  cancel: requestsApi.cancel,
});

/**
 * What to say once an action has gone through.
 * @param {string} key
 * @param {object} r the request as the list returned it
 * @param {boolean} own whether the viewer is its requester
 * @returns {string}
 */
function doneMessage(key, r, own) {
  const what = [r.asset?.name ?? 'the item', r.unit?.tag].filter(Boolean).join(' ');
  switch (key) {
    case 'approve':
      return `Approved. ${what} is on hold for ${r.requester?.name ?? 'the requester'} to collect.`;
    case 'deny':
      return `Denied the request for ${what}.`;
    case 'checkout':
      return own ? `Pickup recorded. ${what} is now with you.` : `Handoff recorded for ${what}.`;
    default:
      return `Cancelled the request for ${what}.`;
  }
}

/**
 * One request's card.
 * @param {{ request: object, showRequester: boolean, actions: object[], busy: string|null,
 *   onAct: (request: object, key: string) => void }} props
 * @returns {JSX.Element}
 */
function RequestCard({ request: r, showRequester, actions, busy, onAct }) {
  const titleId = useId();
  const late = dueStatus(r)?.tone === 'late';
  return (
    <li className="rq-card" data-late={late ? 'true' : undefined}>
      <Link className="rq-title" id={titleId} to={ROUTES.request(r.id)}>
        <span>{r.asset?.name ?? 'Unknown asset'}</span>
        {r.unit ? <span className="tag">{r.unit.tag}</span> : null}
      </Link>
      {showRequester ? (
        <p className="rq-who">
          {r.requester ? (
            <>
              {r.requester.name}
              <span>{r.requester.email}</span>
            </>
          ) : (
            'Unknown user'
          )}
        </p>
      ) : null}
      <p className="rq-when">
        {formatDateOnly(r.neededFrom)} to {formatDateOnly(r.neededTo)}
        {r.asset ? (
          <Link to={ROUTES.asset(r.asset.id)} aria-describedby={titleId}>
            View asset
          </Link>
        ) : null}
      </p>
      <p className="rq-badges">
        <StatusBadge value={r.state}>
          {humanize(r.state)}
          {r.autoApproved && r.state === 'APPROVED' ? ' (automatic)' : ''}
        </StatusBadge>
        <DueBadge request={r} />
      </p>
      {actions.length ? (
        <div className="rq-actions">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={
                action.key === 'approve' || action.key === 'checkout'
                  ? 'small'
                  : action.key === 'deny'
                    ? 'danger-outline small'
                    : 'secondary small'
              }
              aria-describedby={titleId}
              disabled={busy !== null}
              onClick={() => onAct(r, action.key)}
            >
              {busy === `${r.id}:${action.key}` ? 'Working…' : action.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Render the board.
 *
 * `onlyStates`, when given, shows just the columns holding those states — a filtered view should not
 * be three empty columns around the one that matters.
 * @param {{ requests: object[], showRequester?: boolean, onChanged: () => void,
 *   onlyStates?: string[] }} props `onChanged` reloads the list after an action
 * @returns {JSX.Element}
 */
export function RequestBoard({ requests, showRequester = false, onChanged, onlyStates }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const onAct = useCallback(
    async (r, key) => {
      setBusy(`${r.id}:${key}`);
      setNotice(null);
      try {
        await CALLS[key](r.id);
        setNotice({
          tone: 'success',
          message: doneMessage(key, r, Boolean(user?.id) && user.id === String(r.requesterId)),
        });
        onChanged();
      } catch (err) {
        // A 409 means the request moved under us (someone else decided it first); the API's
        // message says so, and the reload shows where it is now.
        setNotice({ tone: 'error', message: errorMessage(err) });
        onChanged();
      } finally {
        setBusy(null);
      }
    },
    [onChanged, user],
  );

  const columns = onlyStates?.length
    ? BOARD_COLUMNS.filter((c) => c.states.some((s) => onlyStates.includes(s)))
    : BOARD_COLUMNS;

  return (
    <>
      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={notice.tone === 'error' ? 'alert alert--inline' : 'notice notice--inline'}
        >
          <p>{notice.message}</p>
          <button type="button" className="secondary small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="board" data-columns={columns.length}>
        {columns.map((column) => {
          const items = requests.filter((r) => column.states.includes(r.state));
          const headingId = `board-${column.key}`;
          return (
            <section key={column.key} className="board-col" aria-labelledby={headingId}>
              <header>
                <h3 id={headingId}>{column.title}</h3>
                <span className="board-count">{items.length}</span>
              </header>
              {items.length ? (
                <ul className="board-list">
                  {items.map((r) => (
                    <RequestCard
                      key={r.id}
                      request={r}
                      showRequester={showRequester}
                      busy={busy}
                      onAct={onAct}
                      actions={actionsFor(r, { role: user?.role, userId: user?.id }).filter((a) =>
                        CARD_ACTIONS.includes(a.key),
                      )}
                    />
                  ))}
                </ul>
              ) : (
                <p className="board-none">{column.empty}</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
