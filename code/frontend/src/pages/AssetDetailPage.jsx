// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: asset detail placeholder wired to useAsset (SCRUM-assets-read)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * One asset and its units.
 *
 * Reached from the catalogue. Placeholder content until its ticket lands; the live API response
 * already populates the category and unit count.
 */
import { useParams } from 'react-router';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { TicketPlaceholder } from '../components/TicketPlaceholder';
import { useAsset } from '../hooks/useAssets';
import { TICKETS } from '../utils/constants';
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
      <TicketPlaceholder ticket={TICKETS.assetDetail} />
      {status === 'loading' ? <LoadingState label="Loading asset…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load this asset" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <dl>
          <dt>Category</dt>
          <dd>{data.category}</dd>
          <dt>Units</dt>
          <dd>{data.units.length}</dd>
        </dl>
      ) : null}
    </>
  );
}
