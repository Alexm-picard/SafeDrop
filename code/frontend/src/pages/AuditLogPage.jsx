// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: audit log screen (SCRUM-51), actor filter and names (SCRUM-46); SCRUM-241 redesign: the trail as a feed grouped by day, one line per event, target filter as chips
// Human Contributions: pending team review

/**
 * The audit log (ORG_ADMIN only) — SCRUM-51.
 *
 * Read-only, permanently: the API offers no way to edit or delete an event, and the model refuses
 * every mutating operation (SR-8). There is deliberately no edit control anywhere on this screen, and
 * the caption says so, because "cannot be edited" is the point of the feature rather than an
 * incidental detail.
 *
 * SCRUM-241: the events read as a feed, grouped under the day they happened, newest first: what
 * happened, who did it with the authority they held at the time, what it happened to, and when. A
 * coloured peg marks the kind of thing it happened to. The target filter is a row of chips; the
 * member, action and date filters sit beside it.
 *
 * Filtering and paging happen server-side. The alternative — fetching everything and filtering in the
 * browser — would send one tenant's entire history to the client and get slower every day the system
 * is used.
 */
import { useCallback, useMemo, useState } from 'react';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useAuditEvents } from '../hooks/useAuditLog';
import { useMembers } from '../hooks/useMembers';
import {
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  AUDIT_TARGET_TYPES,
  ROLE_LABELS,
} from '../utils/constants';
import { humanize, pluralize } from '../utils/format';
/** The filter state when nothing is selected. Empty strings, because they are `<select>`/`<input>` values. */
const NO_FILTERS = Object.freeze({ actorId: '', action: '', targetType: '', from: '', to: '' });
/**
 * How many members to load for the actor filter and the name lookup.
 *
 * 100 is the API's maximum page size, so this is one request rather than a paging loop. An
 * organisation with more members than this would have a short dropdown and would fall back to
 * showing ids for the people beyond it — acceptable while an organisation is one team, and the
 * reason the name lookup below degrades to the id rather than showing nothing.
 */
const ACTOR_LIMIT = 100;

/** The target chips' words: what each kind of record is called on screen. */
const TARGET_LABELS = Object.freeze({
  Organization: 'Organization',
  User: 'People',
  Asset: 'Equipment',
  AssetUnit: 'Units',
  CheckoutRequest: 'Requests',
});

const dayKey = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dayHeading = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});
const dayHeadingWithYear = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const timeOfDay = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * Group a page of events (already newest first) under the local day each happened on.
 * @param {object[]} events
 * @param {Date} [now]
 * @returns {{ key: string, label: string, events: object[] }[]}
 */
function byDay(events, now = new Date()) {
  const today = dayKey.format(now);
  const days = [];
  for (const event of events) {
    const at = new Date(event.timestamp);
    const key = Number.isNaN(at.getTime()) ? 'unknown' : dayKey.format(at);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      const label =
        key === 'unknown'
          ? 'Unknown date'
          : key === today
            ? `Today, ${dayHeading.format(at).split(', ').slice(1).join(', ')}`
            : at.getFullYear() === now.getFullYear()
              ? dayHeading.format(at)
              : dayHeadingWithYear.format(at);
      day = { key, label, events: [] };
      days.push(day);
    }
    day.events.push(event);
  }
  return days;
}
/**
 * Turn an empty string into `undefined` so the API layer leaves the parameter out altogether.
 *
 * `?action=` is not "no filter" to the backend — it fails the Zod enum and comes back a 400.
 * @param {string} value
 * @returns {string|undefined}
 */
const omitEmpty = (value) => (value === '' ? undefined : value);
/**
 * Convert a `<input type="date">` value to an instant at either end of that local day.
 *
 * A date input yields `"2026-09-18"`, which `new Date()` reads as *UTC midnight*. Sent as-is for `to`,
 * that would exclude everything that happened during the day the user picked — the filter would
 * silently drop the most recent events, which is the worst way for an audit tool to be wrong. Building
 * the instant from a local-time string and sending an explicit ISO timestamp removes the ambiguity.
 * @param {string} value `YYYY-MM-DD`, or `''`
 * @param {'start'|'end'} edge which end of the day to land on
 * @returns {string|undefined} an ISO timestamp, or `undefined` when there is no date
 */
function dayBoundary(value, edge) {
  if (!value) {
    return undefined;
  }
  const time = edge === 'start' ? '00:00:00.000' : '23:59:59.999';
  const date = new Date(`${value}T${time}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
/**
 * Render the audit log: filters, a table of events, and pagination.
 *
 * `page` is held separately from `filters` so that changing a filter can reset it to 1. Without that
 * reset, narrowing the filters while on page 3 lands on a page that no longer exists and shows an
 * empty table — the data is there, but the user cannot see it.
 * @returns {JSX.Element}
 */
export function AuditLogPage() {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const params = useMemo(
    () => ({
      page,
      limit: AUDIT_PAGE_SIZE,
      actorId: omitEmpty(filters.actorId),
      action: omitEmpty(filters.action),
      targetType: omitEmpty(filters.targetType),
      from: dayBoundary(filters.from, 'start'),
      to: dayBoundary(filters.to, 'end'),
    }),
    [page, filters],
  );
  const { status, data, error, reload } = useAuditEvents(params);
  // The member list feeds both the actor dropdown and the name lookup in the table. An audit row
  // stores only the actor's id — deliberately, so a later rename cannot rewrite history — but
  // "who did this" has to read as a person, so the name is resolved here at display time.
  const { data: memberData } = useMembers({ limit: ACTOR_LIMIT });
  const actors = useMemo(() => memberData?.items ?? [], [memberData]);
  const actorNameById = useMemo(
    () => new Map(actors.map((actor) => [actor.id, actor.name])),
    [actors],
  );
  const updateFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);
  const clearFilters = useCallback(() => {
    setFilters(NO_FILTERS);
    setPage(1);
  }, []);
  const hasFilters = Object.values(filters).some((value) => value !== '');
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Audit log</h1>
          <p className="subtitle">
            Every request, approval, checkout, return and inventory change is recorded here and can
            never be edited or deleted.
          </p>
        </div>
      </header>
      <form
        className="feed-filters"
        aria-label="Filter audit events"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="chips" role="group" aria-label="Target">
          {[['', 'Everything'], ...AUDIT_TARGET_TYPES.map((t) => [t, TARGET_LABELS[t] ?? t])].map(
            ([value, label]) => (
              <button
                key={value || 'all'}
                type="button"
                className="chip"
                aria-pressed={filters.targetType === value}
                onClick={() => updateFilter('targetType', value)}
              >
                {label}
              </button>
            ),
          )}
        </div>
        <div className="feed-fields">
          <div className="field">
            <label htmlFor="filter-actor">Member</label>
            <select
              id="filter-actor"
              value={filters.actorId}
              onChange={(e) => updateFilter('actorId', e.target.value)}
            >
              <option value="">All members</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-action">Action</label>
            <select
              id="filter-action"
              value={filters.action}
              onChange={(e) => updateFilter('action', e.target.value)}
            >
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {humanize(action)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-from">From</label>
            <input
              id="filter-from"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => updateFilter('from', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="filter-to">To</label>
            <input
              id="filter-to"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => updateFilter('to', e.target.value)}
            />
          </div>
          {hasFilters ? (
            <button type="button" className="secondary" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      </form>
      {status === 'loading' ? <LoadingState label="Loading audit events…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the audit log" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <>
          <p className="hint" role="status">
            {pluralize(total, 'event')}
            {hasFilters ? ' matching the filters' : ''}
          </p>
          {data.items.length === 0 ? (
            <p className="empty-state">
              {hasFilters ? 'No events match these filters.' : 'No activity has been recorded yet.'}
            </p>
          ) : (
            <section className="feed" aria-labelledby="feed-heading">
              <h2 id="feed-heading" className="visually-hidden">
                Audit events
              </h2>
              <p className="feed-note">Newest first. This record cannot be edited.</p>
              {byDay(data.items).map((day) => (
                <section key={day.key} className="feed-day" aria-labelledby={`day-${day.key}`}>
                  <h3 id={`day-${day.key}`} className="feed-day-head">
                    {day.label}
                    <span>{pluralize(day.events.length, 'event')}</span>
                  </h3>
                  <ol className="feed-events">
                    {day.events.map((e) => (
                      <li key={e.id} className="feed-event" data-target={e.targetType}>
                        <span className="feed-peg" aria-hidden="true" />
                        <div className="feed-text">
                          <p>
                            <strong>{humanize(e.action)}</strong>
                            {/* Name first, because "who" is the question this screen is read for.
                                The role is the authority they acted with *at the time*, stored on
                                the event, so it is not looked up from the member list — a later
                                promotion must not rewrite the record. The id is the fallback for an
                                actor the member list does not cover: someone who has since left,
                                or, past ACTOR_LIMIT, someone not on the loaded page. No id at all is
                                an event no person caused (SCRUM-205: an expired approval), shown by
                                its role label. */}
                            {e.actorId ? (
                              <>
                                {' by '}
                                <span className="feed-actor">
                                  {actorNameById.get(e.actorId) ?? e.actorId}
                                </span>{' '}
                                <span className="feed-role">
                                  {ROLE_LABELS[e.actorRole] ?? e.actorRole}
                                </span>
                              </>
                            ) : (
                              <>
                                {' '}
                                <span className="feed-role">
                                  {ROLE_LABELS[e.actorRole] ?? e.actorRole}
                                </span>
                              </>
                            )}
                          </p>
                          <p className="feed-target">
                            {TARGET_LABELS[e.targetType] ?? e.targetType}{' '}
                            <span className="meta">{e.targetId}</span>
                          </p>
                        </div>
                        <time dateTime={e.timestamp}>
                          {Number.isNaN(new Date(e.timestamp).getTime())
                            ? '—'
                            : timeOfDay.format(new Date(e.timestamp))}
                        </time>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </section>
          )}
          {lastPage > 1 ? (
            <nav className="pagination" aria-label="Audit log pages">
              <button
                type="button"
                className="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span>
                Page {page} of {lastPage}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              >
                Next
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}
