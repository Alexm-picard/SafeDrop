// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~95%
// AI-Assisted Areas: SCRUM-241 redesign: the overview's loan timeline (every live request on its dates, against today)
// Human Contributions: pending team review
// Notes: Reads the organisation-wide request list the approval board already uses; nothing new is computed on the server.

/**
 * Every live request on one timeline: a bar from the day it is needed to the day it is due back,
 * against a line for today. A loan still out past its due date runs on to today in the danger colour,
 * so how late it is reads as a length rather than a number to compare.
 *
 * Shows the requests that matter now — waiting, approved, out, and those that finished inside the
 * window — newest first, up to ROW_LIMIT, with a link to the board for the rest. Denied and cancelled
 * requests never became loans, so they are left off.
 *
 * Each row is a link to the request, labelled with the asset, the unit, its state and its dates, so a
 * screen reader hears what the bar shows. The bars and the scale are decoration on top of that.
 */
import { Link } from 'react-router';
import { useRequests } from '../hooks/useRequests';
import { ROUTES } from '../utils/constants';
import { dueStatus } from '../utils/dueStatus';
import { formatDateOnly, humanize } from '../utils/format';

/** The largest page the API serves: enough to draw everything live in a typical organisation. */
const TIMELINE_PARAMS = Object.freeze({ scope: 'org', limit: 100 });
const ROW_LIMIT = 8;
const DAY_MS = 86_400_000;
/** The window: eight weeks back, three weeks ahead. */
const DAYS_BEFORE = 56;
const DAYS_AFTER = 21;
const LIVE = Object.freeze(['PENDING', 'APPROVED', 'CHECKED_OUT', 'OVERDUE', 'RETURN_PENDING']);
const FINISHED = Object.freeze(['RETURNED', 'LOST', 'EXPIRED']);
const SHORT_LABEL = Object.freeze({ APPROVED: 'On hold', CHECKED_OUT: 'Out' });

const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/**
 * The bar's kind (its colour) and its words.
 * @param {object} r
 * @returns {{ kind: string, label: string, late: boolean }}
 */
function barOf(r) {
  const due = dueStatus(r);
  if (due?.tone === 'late') return { kind: 'late', label: due.label, late: true };
  if (r.state === 'PENDING') return { kind: 'pending', label: 'Pending', late: false };
  if (r.state === 'APPROVED') return { kind: 'approved', label: SHORT_LABEL.APPROVED, late: false };
  if (LIVE.includes(r.state)) {
    return { kind: 'out', label: SHORT_LABEL[r.state] ?? humanize(r.state), late: false };
  }
  return { kind: 'closed', label: humanize(r.state), late: false };
}

/**
 * Render the timeline.
 * @param {{ now?: Date }} props `now` is for tests; the page leaves it out
 * @returns {JSX.Element}
 */
export function LoanTimeline({ now }) {
  const { status, data } = useRequests(TIMELINE_PARAMS);
  const today = now ?? new Date();
  const start = new Date(today.getTime() - DAYS_BEFORE * DAY_MS);
  const end = new Date(today.getTime() + DAYS_AFTER * DAY_MS);
  const pct = (value) => {
    const t = new Date(value).getTime();
    return Math.max(0, Math.min(100, ((t - start) / (end - start)) * 100));
  };

  const rows = (data?.items ?? [])
    .filter(
      (r) =>
        LIVE.includes(r.state) ||
        (FINISHED.includes(r.state) && new Date(r.neededTo ?? r.neededFrom) >= start),
    )
    .sort((a, b) => new Date(b.neededFrom) - new Date(a.neededFrom))
    .slice(0, ROW_LIMIT);

  // A tick on the 1st and the 15th of each month inside the window.
  const ticks = [];
  for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end;) {
    for (const day of [1, 15]) {
      const tick = new Date(d.getFullYear(), d.getMonth(), day);
      if (tick >= start && tick <= end) ticks.push(tick);
    }
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }

  const todayAt = pct(today) / 100;

  return (
    <section className="timeline-card" aria-labelledby="loans-heading">
      <div className="timeline-card-head">
        <h2 id="loans-heading">Loans</h2>
        <p className="hint">
          Every live request on its dates, {monthDay.format(start)} to {monthDay.format(end)}.{' '}
          <Link to={ROUTES.approvals}>Open the requests board</Link>
        </p>
      </div>
      {status === 'error' ? (
        <p className="hint timeline-note">The loans could not be loaded. The board has them all.</p>
      ) : !data ? (
        <p className="hint timeline-note">Loading loans…</p>
      ) : rows.length === 0 ? (
        <p className="hint timeline-note">Nothing is waiting, on hold or out on loan right now.</p>
      ) : (
        <div className="tl-body">
          <div className="tl-scale" aria-hidden="true">
            <span />
            <div>
              {ticks.map((tick) => (
                <span key={tick.toISOString()} style={{ left: `${pct(tick)}%` }}>
                  {monthDay.format(tick)}
                </span>
              ))}
            </div>
          </div>
          <ul className="tl-rows">
            {rows.map((r) => {
              const bar = barOf(r);
              const from = pct(r.neededFrom);
              const to = bar.late ? pct(today) : pct(r.dueAt ?? r.neededTo ?? r.neededFrom);
              const name = [r.asset?.name ?? 'Unknown asset', r.unit?.tag]
                .filter(Boolean)
                .join(' ');
              return (
                <li key={r.id}>
                  <Link
                    className="tl-row"
                    to={ROUTES.request(r.id)}
                    aria-label={`${name}, ${r.requester?.name ?? 'unknown requester'}: ${bar.label}, ${formatDateOnly(r.neededFrom)} to ${formatDateOnly(r.neededTo)}`}
                  >
                    <span className="tl-who">
                      <b>{r.asset?.name ?? 'Unknown asset'}</b>
                      <span>{[r.requester?.name, r.unit?.tag].filter(Boolean).join(' · ')}</span>
                      <em className="tl-state" data-kind={bar.kind}>
                        {bar.label}
                      </em>
                    </span>
                    <span className="tl-lane">
                      <span
                        className="tl-bar"
                        data-kind={bar.kind}
                        style={{ left: `${from}%`, width: `${Math.max(2, to - from)}%` }}
                      >
                        {bar.label}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <span
            className="tl-today"
            aria-hidden="true"
            style={{
              left: `calc(var(--tl-label) + (100% - var(--tl-label) - var(--tl-pad)) * ${todayAt.toFixed(4)})`,
            }}
          />
        </div>
      )}
    </section>
  );
}
