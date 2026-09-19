// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: asset detail page wired to useAsset, showing its units and their statuses
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * One asset and its units.
 *
 * Reached from the catalogue. SCRUM-115: shows every unit's tag, status and condition, so a member
 * can see what is actually available before requesting one — requesting itself belongs to a later
 * ticket (SCRUM-58, checkout/return).
 */
import { useParams } from 'react-router';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useAsset } from '../hooks/useAssets';
import { humanize } from '../utils/format';
/**
 * Render one asset's details, keyed by the `:id` route parameter.
 *
 * The id defaults to an empty string so a malformed URL produces an ordinary failed request with an
 * error state, rather than a crash on an undefined parameter. The heading falls back to "Asset" until
 * the data arrives, so the page does not shift its title as it loads.
 * @returns {JSX.Element}
 */
export function AssetDetailPage() {
  const { id = '' } = useParams();
  const { status, data, error, reload } = useAsset(id);
  return (
    <>
      <h1>{status === 'success' && data ? data.name : 'Asset'}</h1>
      {status === 'loading' ? <LoadingState label="Loading asset…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load this asset" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <>
          <dl>
            <dt>Category</dt>
            <dd>{data.category}</dd>
            {data.description ? (
              <>
                <dt>Description</dt>
                <dd>{data.description}</dd>
              </>
            ) : null}
          </dl>
          <DataTable
            caption="Units"
            columns={[
              { key: 'tag', header: 'Tag', render: (u) => u.tag },
              { key: 'status', header: 'Status', render: (u) => humanize(u.status) },
              { key: 'condition', header: 'Condition', render: (u) => humanize(u.condition) },
            ]}
            rows={data.units}
            getRowId={(u) => u.id}
            emptyMessage="This asset has no units yet."
          />
        </>
      ) : null}
    </>
  );
}
