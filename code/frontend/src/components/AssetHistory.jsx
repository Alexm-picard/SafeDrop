/**
 * One asset's chain of custody (SCRUM-29, SCRUM-40).
 *
 * The screen that settles a dispute: who held this, when, and who approved it. Rendered under the
 * asset's units on the detail page, for an ORG_ADMIN only.
 *
 * **Newest first, matching the audit log.** Both screens read the same trail, and an investigator
 * moving between them should not have to re-learn which end is which. It is the opposite of the
 * request timeline on RequestDetailPage, which is oldest-first because a single request is a short
 * story read forwards; an asset's history is long and the recent end is the part being asked about.
 *
 * **Read-only, permanently.** There is no edit control here and there never will be: the API exposes
 * no way to change or delete an audit event (SR-8). The caption says so, because that guarantee is
 * the feature rather than an incidental detail.
 *
 * **A 403 is handled rather than merely reported** (SCRUM-41). The page only renders this for an
 * admin, but that is a usability choice and not a security control — the API decides (SR-1) — so a
 * caller who reaches it another way gets a plain explanation instead of a red failure panel that
 * reads like a bug.
 */
import { useState } from 'react';
import { useAssetHistory } from '../hooks/useAssets';
import { isApiError } from '../services/api';
import { AUDIT_PAGE_SIZE, ROLE_LABELS } from '../utils/constants';
import { formatDate, humanize, pluralize } from '../utils/format';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
/**
 * Render one event as a line of the timeline.
 *
 * The actor's name comes first because "who" is the question this screen exists to answer; the role
 * follows it as the authority they acted with *at the time*, which is stored on the event and is not
 * necessarily the role they hold now.
 *
 * `unitTag` is shown only when the event concerned a specific physical unit. An asset-level event
 * (created, edited, retired) has none, and inventing one would claim something the record does not
 * say.
 * @param {{ event: { action: string, timestamp: string, unitTag: string|null, actor: { name: string, role: string } } }} props
 * @returns {JSX.Element}
 */
function HistoryEntry({ event }) {
  return (
    <li>
      <strong>{humanize(event.action)}</strong>
      {event.unitTag ? <span className="meta"> unit {event.unitTag}</span> : null}
      <div>
        <span>{event.actor.name}</span>
        <span className="meta"> {ROLE_LABELS[event.actor.role] ?? event.actor.role}</span>
      </div>
      <div className="meta">{formatDate(event.timestamp)}</div>
    </li>
  );
}
/**
 * Render the asset's history: every event recorded against it, its units and its requests.
 *
 * Paged rather than scrolled, the same way the audit log is, because the whole history of a
 * long-lived asset is unbounded — a laptop lent out weekly for three years is several hundred events
 * — and sending all of it to settle one dispute is the wrong trade.
 *
 * `page` is deliberately not reset by anything here: there are no filters on this screen, so the only
 * thing that changes the page is the pagination itself.
 * @param {{ assetId: string }} props
 * @returns {JSX.Element}
 */
export function AssetHistory({ assetId }) {
  const [page, setPage] = useState(1);
  const { status, data, error, reload } = useAssetHistory(assetId, {
    page,
    limit: AUDIT_PAGE_SIZE,
  });

  // The API is the authority on who may read the trail; this screen only has to explain the answer.
  if (status === 'error' && isApiError(error) && error.status === 403) {
    return (
      <section>
        <h2>History</h2>
        <p className="hint">
          Only an organization administrator can view an asset&rsquo;s history.
        </p>
      </section>
    );
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  return (
    <section>
      <h2>History</h2>
      {status === 'loading' && !data ? <LoadingState label="Loading history…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load this asset’s history" onRetry={reload} />
      ) : null}
      {status !== 'error' && data ? (
        <>
          <p className="hint" role="status">
            {pluralize(total, 'event')}, newest first. This record cannot be edited.
          </p>
          {data.items.length === 0 ? (
            <p className="hint">Nothing has been recorded against this asset yet.</p>
          ) : (
            <ol className="timeline" aria-label="Asset history">
              {data.items.map((event) => (
                <HistoryEntry key={event.id} event={event} />
              ))}
            </ol>
          )}
          {lastPage > 1 ? (
            <nav className="pagination" aria-label="Asset history pages">
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
    </section>
  );
}
