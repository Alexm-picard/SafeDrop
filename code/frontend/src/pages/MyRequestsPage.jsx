// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: my-requests page wired to the real GET /api/requests endpoint (SCRUM-requests-list)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * A member's own checkout requests.
 *
 * Which requests come back is the API's decision, not this page's: the same endpoint returns only
 * what the caller may see (SR-1) — no `scope` is passed here, so this is always "my own," even for
 * an approver or admin who could ask the same endpoint for the organisation-wide view elsewhere
 * (see ApprovalQueuePage).
 */
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useRequests } from '../hooks/useRequests';
import { formatDate, humanize } from '../utils/format';
/**
 * Render the member's requests as a table.
 *
 * States are passed through `humanize`, so `CHECKED_OUT` reads as "Checked out" — and a state added
 * on the backend still displays sensibly without a label map here.
 * @returns {JSX.Element}
 */
export function MyRequestsPage() {
  const { status, data, error, reload } = useRequests();
  return (
    <>
      <h1>My requests</h1>
      {status === 'loading' ? <LoadingState label="Loading your requests…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load your requests" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <DataTable
          caption="Requests"
          columns={[
            { key: 'state', header: 'State', render: (r) => humanize(r.state) },
            { key: 'from', header: 'Needed from', render: (r) => formatDate(r.neededFrom) },
            { key: 'to', header: 'Needed until', render: (r) => formatDate(r.neededTo) },
          ]}
          rows={data.items}
          getRowId={(r) => r.id}
          emptyMessage="You have not requested anything yet."
        />
      ) : null}
    </>
  );
}
