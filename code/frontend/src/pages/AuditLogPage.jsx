/**
 * The audit log (ORG_ADMIN only) — SCRUM-51.
 *
 * Read-only, permanently: the API offers no way to edit or delete an event, and the model refuses
 * every mutating operation (SR-8). There is deliberately no edit control anywhere on this screen, and
 * the caption says so, because "cannot be edited" is the point of the feature rather than an
 * incidental detail.
 *
 * Filtering and paging happen server-side. The alternative — fetching everything and filtering in the
 * browser — would send one tenant's entire history to the client and get slower every day the system
 * is used.
 */
import { useCallback, useMemo, useState } from 'react';
import { DataTable } from '../components/DataTable';
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
import { formatDate, humanize, pluralize } from '../utils/format';
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
      <h1>Audit log</h1>
      <p className="hint">
        Every request, approval, checkout, return and inventory change is recorded here and can
        never be edited or deleted.
      </p>
      <form
        className="filters"
        aria-label="Filter audit events"
        onSubmit={(e) => e.preventDefault()}
      >
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
          <label htmlFor="filter-target-type">Target</label>
          <select
            id="filter-target-type"
            value={filters.targetType}
            onChange={(e) => updateFilter('targetType', e.target.value)}
          >
            <option value="">All targets</option>
            {AUDIT_TARGET_TYPES.map((targetType) => (
              <option key={targetType} value={targetType}>
                {targetType}
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
          <DataTable
            caption="Audit events, newest first. This record cannot be edited."
            columns={[
              {
                key: 'timestamp',
                header: 'When',
                render: (e) => formatDate(e.timestamp),
              },
              {
                key: 'action',
                header: 'Action',
                render: (e) => humanize(e.action),
              },
              {
                key: 'actor',
                header: 'Actor',
                // Name first, because "who" is the question this screen is read for. The role is the
                // authority they acted with *at the time*, stored on the row, so it is not looked up
                // from the member list — a later promotion must not rewrite the record. The id is the
                // fallback for an actor the member list does not cover: someone who has since left,
                // or, past ACTOR_LIMIT, someone simply not on the loaded page.
                render: (e) => (
                  <>
                    {actorNameById.get(e.actorId) ?? e.actorId}
                    <span className="meta"> {ROLE_LABELS[e.actorRole] ?? e.actorRole}</span>
                  </>
                ),
              },
              {
                key: 'target',
                header: 'Target',
                render: (e) => (
                  <>
                    {e.targetType}
                    <span className="meta"> {e.targetId}</span>
                  </>
                ),
              },
            ]}
            rows={data.items}
            getRowId={(e) => e.id}
            emptyMessage={
              hasFilters ? 'No events match these filters.' : 'No activity has been recorded yet.'
            }
          />
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
