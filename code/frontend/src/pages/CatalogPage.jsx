// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: catalogue page wired to useAssets; renders ErrorState while the API answers 501 (SCRUM-assets-list)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The catalogue: the landing page for every signed-in user.
 *
 * Also the destination `RequireRole` redirects to, so it is where a user arrives after trying to open
 * an admin page they cannot see — hence the denial notice.
 *
 * The browsing and requesting behaviour belongs to a later ticket, so the page shows a
 * `TicketPlaceholder` above a table driven by the live API response.
 */
import { Link, useLocation } from 'react-router';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { TicketPlaceholder } from '../components/TicketPlaceholder';
import { useAssets } from '../hooks/useAssets';
import { ROUTES, TICKETS } from '../utils/constants';
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
  const denied = Boolean(location.state?.denied);
  return (
    <>
      <h1>Catalog</h1>
      {denied ? (
        <div role="alert" className="alert">
          You do not have access to that page.
        </div>
      ) : null}
      <TicketPlaceholder ticket={TICKETS.catalog}>
        Browsing and requesting assets arrives with that ticket; the list below shows the live API
        response.
      </TicketPlaceholder>
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
