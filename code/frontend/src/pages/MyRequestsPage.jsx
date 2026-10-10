// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: my-requests page wired to the real GET /api/requests endpoint (SCRUM-119); "(automatic)" marker for auto-approved requests (SCRUM-148); SCRUM-241 redesign: the requests as a board by stage, with the one-click next steps on each card
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * A member's own checkout requests.
 *
 * Which requests come back is the API's decision, not this page's: the same endpoint returns only
 * what the caller may see (SR-1) — no `scope` is passed here, so this is always "my own," even for
 * an approver or admin who could ask the same endpoint for the organisation-wide view elsewhere
 * (see ApprovalQueuePage).
 */
import { Link } from 'react-router';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { RequestBoard } from '../components/RequestBoard';
import { useAuth } from '../hooks/useAuth';
import { useRequests } from '../hooks/useRequests';
import { ROLES, ROUTES } from '../utils/constants';

/**
 * Render the viewer's requests as a board, one column per stage.
 *
 * An approver or admin also has the organisation-wide board (the approval queue); the two links under
 * the title switch between them, so "everyone's" and "mine" read as two views of one page.
 *
 * The Due badge (SCRUM-143) on each loan is the one piece of derived data: everything else is a field
 * of the request, while that is computed from `dueAt` against the clock by `dueStatus`.
 * @returns {JSX.Element}
 */
export function MyRequestsPage() {
  const { status, data, error, reload } = useRequests();
  const { role } = useAuth();
  const canApprove = role === ROLES.APPROVER || role === ROLES.ORG_ADMIN;
  return (
    <>
      <header className="page-header">
        <div>
          <h1>My requests</h1>
          <p className="subtitle">Everything you asked to borrow, and where it is now.</p>
        </div>
        <div className="actions">
          {canApprove ? (
            <nav className="view-switch" aria-label="Whose requests">
              <Link to={ROUTES.approvals}>Everyone’s</Link>
              <Link to={ROUTES.myRequests} aria-current="page">
                Mine
              </Link>
            </nav>
          ) : null}
          <Link className="button" to={ROUTES.catalog}>
            Browse the catalog
          </Link>
        </div>
      </header>
      {status === 'loading' ? <LoadingState label="Loading your requests…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load your requests" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        data.items.length === 0 ? (
          <p className="empty-state">You have not requested anything yet.</p>
        ) : (
          <RequestBoard requests={data.items} onChanged={reload} />
        )
      ) : null}
    </>
  );
}
