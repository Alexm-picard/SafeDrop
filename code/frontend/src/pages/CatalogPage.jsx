// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: catalogue page wired to useAssets, with loading, error and empty states
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The catalogue: the landing page for every signed-in user.
 *
 * Also the destination `RequireRole` redirects to, so it is where a user arrives after trying to open
 * an admin page they cannot see — hence the denial notice.
 *
 * SCRUM-115: lists the caller's organisation's non-retired assets. Requesting a unit belongs to a
 * later ticket (SCRUM-58, checkout/return), so a row links only to the asset's detail page for now.
 */
import { Link, useLocation } from 'react-router';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useAssets } from '../hooks/useAssets';
import { useAuth } from '../hooks/useAuth';
import { ROLES, ROUTES } from '../utils/constants';
/**
 * Render the catalogue, with loading, error and empty states.
 *
 * The three states from `useApiResource` map to the three shared components, which is the pattern
 * every list screen in the SPA follows. `reload` is handed to `ErrorState` so a failure is
 * recoverable without a page refresh.
 *
 * `location.state.denied` is set by `RequireRole` when it turns someone away; showing it here means
 * the redirect explains itself rather than silently landing the user somewhere else.
 * @returns {JSX.Element}
 */
export function CatalogPage() {
  const { status, data, error, reload } = useAssets();
  const location = useLocation();
  const { role } = useAuth();
  const denied = Boolean(location.state?.denied);
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
      {status === 'loading' ? <LoadingState label="Loading assets…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the catalog" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <DataTable
          caption="Assets"
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (a) => <Link to={ROUTES.asset(a.id)}>{a.name}</Link>,
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
