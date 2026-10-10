// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: catalogue list (SCRUM-115), search (SCRUM-201), Restricted badge (SCRUM-150, SCRUM-202); SCRUM-241 redesign: the catalogue and search results as a gallery of cards
// Human Contributions: pending team review

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
import { AssetCard } from '../components/AssetCard';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
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
      <header className="page-header">
        <div>
          <h1>Catalog</h1>
          <p className="subtitle">
            Everything your organization lends out. Open an item to see its units and request one.
          </p>
        </div>
        {/* SCRUM-122: the admin's way into the create form. Shown here rather than in the primary
            nav because the catalogue is where inventory is managed from, and the nav is shared with
            two roles that cannot use it. Hiding it is usability only — the API enforces
            `assets:write`. */}
        {role === ROLES.ORG_ADMIN ? (
          <p className="actions">
            <Link className="button" to={ROUTES.assetNew}>
              New asset
            </Link>
          </p>
        ) : null}
        {/* Searching happens as you type, so there is nothing to submit; preventing it stops Enter
            from reloading the page. */}
        <form
          role="search"
          className="catalog-search page-header-extra"
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="catalog-search" className="visually-hidden">
            Search the catalog
          </label>
          <input
            id="catalog-search"
            type="search"
            value={text}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder="What do you need? For example, something to record a lecture"
            onChange={(event) => setText(event.target.value)}
          />
        </form>
      </header>
      {denied ? (
        <div role="alert" className="alert">
          You do not have access to that page.
        </div>
      ) : null}
      {searching ? <SearchResults q={q} {...search} /> : null}
      {!searching && status === 'loading' ? <LoadingState label="Loading assets…" /> : null}
      {!searching && status === 'error' ? (
        <ErrorState error={error} title="Could not load the catalog" onRetry={reload} />
      ) : null}
      {!searching && status === 'success' && data ? (
        data.items.length === 0 ? (
          <p className="empty-state">No assets yet.</p>
        ) : (
          // SCRUM-150: restricted assets stay listed, badged on the card, rather than hidden.
          <ul className="gallery" aria-label="Assets">
            {data.items.map((a) => (
              <li key={a.id}>
                <AssetCard
                  id={a.id}
                  name={a.name}
                  category={a.category}
                  imageUrl={a.imageUrl}
                  allowedGroups={a.allowedGroups}
                  restricted={a.restricted}
                />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}

/**
 * The matches for one query, in place of the catalogue: the same cards, with the model's reason on
 * each when the search was AI-assisted, and its clarifying question above them.
 * @param {{ q: string, status: string, data: object|null, error: unknown, reload: () => void }} props
 * @returns {JSX.Element}
 */
function SearchResults({ q, status, data, error, reload }) {
  if (status === 'error') {
    return <ErrorState error={error} title="Could not search the catalog" onRetry={reload} />;
  }
  if (status === 'loading' || data?.q !== q) {
    return <LoadingState label="Searching…" />;
  }
  return (
    <>
      {data.clarification ? (
        <p className="hint search-clarification">{data.clarification}</p>
      ) : null}
      {data.matches.length === 0 ? (
        <p className="empty-state">No assets match “{q}”.</p>
      ) : (
        <ul className="gallery" aria-label="Search results">
          {data.matches.map((m) => (
            <li key={m.assetId}>
              {/* SCRUM-202: the same Restricted badge as the list. */}
              <AssetCard
                id={m.assetId}
                name={m.name}
                category={m.category}
                imageUrl={m.imageUrl}
                allowedGroups={m.allowedGroups}
                restricted={m.restricted}
                reason={data.aiAssisted ? m.reason : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
