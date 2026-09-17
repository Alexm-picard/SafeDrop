// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: catalogue page wired to useAssets; renders ErrorState while the API answers 501 (SCRUM-assets-list)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { Link, useLocation } from 'react-router';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { TicketPlaceholder } from '../components/TicketPlaceholder';
import { useAssets } from '../hooks/useAssets';
import { ROUTES, TICKETS } from '../utils/constants';
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
