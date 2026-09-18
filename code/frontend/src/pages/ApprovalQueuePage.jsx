// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: approval queue placeholder wired to pending requests (SCRUM-requests-approve)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The approval queue: requests waiting on a decision (APPROVER and ORG_ADMIN).
 *
 * The deciding itself belongs to a later ticket, so the page currently shows how many requests are
 * waiting.
 */
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { TicketPlaceholder } from '../components/TicketPlaceholder';
import { useRequests } from '../hooks/useRequests';
import { TICKETS } from '../utils/constants';
import { pluralize } from '../utils/format';
/**
 * Render the pending-request queue.
 *
 * Asks the shared requests hook for `state: 'PENDING'` only — the queue is a filter over the same
 * endpoint the member's list uses, not a separate one.
 * @returns {JSX.Element}
 */
export function ApprovalQueuePage() {
  const { status, data, error, reload } = useRequests({ state: 'PENDING' });
  return (
    <>
      <h1>Approval queue</h1>
      <TicketPlaceholder ticket={TICKETS.approvalQueue}>
        Approving and denying requests arrives with that ticket. Only an approver who is not the
        requester may decide.
      </TicketPlaceholder>
      {status === 'loading' ? <LoadingState label="Loading pending requests…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the queue" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? <p>{pluralize(data.total, 'pending request')}</p> : null}
    </>
  );
}
