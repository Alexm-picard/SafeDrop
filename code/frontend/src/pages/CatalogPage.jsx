/**
 * The catalogue: the landing page for every signed-in user.
 *
 * Also the destination `RequireRole` redirects to, so it is where a user arrives after trying to open
 * an admin page they cannot see — hence the denial notice.
 *
 * SCRUM-115: lists the caller's organisation's non-retired assets. Requesting a unit belongs to a
 * later ticket (SCRUM-58, checkout/return), so a row links only to the asset's detail page for now.
 *
 * SCRUM-201: a search bar above the list. While it holds text, the matches replace the list; clearing
 * it brings the list straight back.
 *
 * SCRUM-150: a restricted asset stays in the list — and in search results (SCRUM-202) — with a
 * Restricted badge naming its groups on hover, rather than being hidden, so a member learns what they
 * would need instead of wondering where it went.
 */
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { RestrictedBadge } from '../components/RestrictedBadge';
import { useAssets, useAssetSearch } from '../hooks/useAssets';
import { useAuth } from '../hooks/useAuth';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { ROLES, ROUTES } from '../utils/constants';

/**
 * How long typing must pause before a search is sent. Each search may be an AI call, so a burst of
 * keystrokes should cost one; much longer than this and the page feels like it is ignoring the user.
 */
const SEARCH_DEBOUNCE_MS = 300;

/** The longest query the API accepts (`searchQuery` in routes/assets.routes.js). */
const SEARCH_MAX_LENGTH = 200;

/**
 * Render the catalogue, with loading, error and empty states, and the search bar above it.
 *
 * The three states from `useApiResource` map to the three shared components, which is the pattern
 * every list screen in the SPA follows. `reload` is handed to `ErrorState` so a failure is
 * recoverable without a page refresh.
 *
 * `location.state.denied` is set by `RequireRole` when it turns someone away; showing it here means
 * the redirect explains itself rather than silently landing the user somewhere else.
 *
 * Search shows only when both the live text and the debounced query are non-blank. The live check
 * makes clearing the box restore the catalogue at once, rather than one debounce later; the debounced
 * one keeps the catalogue up until there is a query to answer.
 * @returns {JSX.Element}
 */
export function CatalogPage() {
  const { status, data, error, reload } = useAssets();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const search = useAssetSearch(q);
  const location = useLocation();
  const { role } = useAuth();
  const denied = Boolean(location.state?.denied);
  const searching = text.trim() !== '' && q !== '';
  return (
    <>
      <h1>Catalog</h1>
      {denied ? (
        <div role="alert" className="alert">
          You do not have access to that page.
        </div>
      ) : null}
      {/* SCRUM-122: the admin's way into the create form. Shown here rather than in the primary nav
          because the catalogue is where inventory is managed from, and the nav is shared with two
          roles that cannot use it. Hiding it is usability only — the API enforces `assets:write`. */}
      {role === ROLES.ORG_ADMIN ? (
        <p className="actions">
          <Link className="button" to={ROUTES.assetNew}>
            New asset
          </Link>
        </p>
      ) : null}
      {/* Searching happens as you type, so there is nothing to submit; preventing it stops Enter
          from reloading the page. */}
      <form role="search" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="catalog-search">Search the catalog</label>
        <input
          id="catalog-search"
          type="search"
          value={text}
          maxLength={SEARCH_MAX_LENGTH}
          placeholder="e.g. something to record a lecture"
          onChange={(event) => setText(event.target.value)}
        />
      </form>
      {searching ? <SearchResults q={q} {...search} /> : null}
      {!searching && status === 'loading' ? <LoadingState label="Loading assets…" /> : null}
      {!searching && status === 'error' ? (
        <ErrorState error={error} title="Could not load the catalog" onRetry={reload} />
      ) : null}
      {!searching && status === 'success' && data ? (
        <DataTable
          caption="Assets"
          columns={[
            {
              key: 'name',
              header: 'Name',
              // SCRUM-150: restricted assets stay listed, badged beside (not inside) the link so the
              // link's name is still just the asset's.
              render: (a) => (
                <>
                  <Link to={ROUTES.asset(a.id)}>{a.name}</Link>
                  <RestrictedBadge allowedGroups={a.allowedGroups} restricted={a.restricted} />
                </>
              ),
            },
            { key: 'category', header: 'Category', render: (a) => a.category },
          ]}
          rows={data.items}
          getRowId={(a) => a.id}
          emptyMessage="No assets yet."
        />
      ) : null}
    </>
  );
}

/**
 * The matches for `q`, in the order the API returned them.
 *
 * "Searching…" shows until the data answers *this* query: `useApiResource` keeps the previous
 * results while a new request is in flight, so `status` alone would show stale matches as current.
 *
 * AI-ranked and plain results render the same way, except that AI results add the model's reason
 * per match and may carry a clarifying question. A plain result after an AI failure therefore looks
 * like any other search — the fallback is the backend's business, not the member's (SCRUM-103 AT2).
 * @param {{ q: string, status: string, data: ({ q: string, matches: object[], clarification: string|null, aiAssisted: boolean }|null), error: unknown, reload: () => void }} props
 * @returns {JSX.Element}
 */
function SearchResults({ q, status, data, error, reload }) {
  if (status === 'error') {
    return <ErrorState error={error} title="Could not search the catalog" onRetry={reload} />;
  }
  if (status === 'loading' || data?.q !== q) {
    return <LoadingState label="Searching…" />;
  }
  const columns = [
    {
      key: 'name',
      header: 'Name',
      // SCRUM-202: the same Restricted badge as the list, beside the link.
      render: (m) => (
        <>
          <Link to={ROUTES.asset(m.assetId)}>{m.name}</Link>
          <RestrictedBadge allowedGroups={m.allowedGroups} restricted={m.restricted} />
        </>
      ),
    },
    { key: 'category', header: 'Category', render: (m) => m.category },
  ];
  if (data.aiAssisted) {
    columns.push({ key: 'reason', header: 'Why it matches', render: (m) => m.reason });
  }
  return (
    <>
      {data.clarification ? <p className="hint">{data.clarification}</p> : null}
      <DataTable
        caption="Search results"
        columns={columns}
        rows={data.matches}
        getRowId={(m) => m.assetId}
        emptyMessage={`No assets match “${q}”.`}
      />
    </>
  );
}
