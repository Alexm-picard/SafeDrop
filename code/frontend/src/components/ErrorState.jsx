// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: accessible error panel (role=alert) with code/requestId and optional retry (SCRUM-103 AC2)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The shared error panel for a failed data load.
 *
 * One place decides how an error is presented, so every screen reports failure the same way and the
 * diagnostic details a user can quote — the API's code, the HTTP status, the request id — are always
 * there.
 */
import { errorMessage, isApiError } from '../services/api';
/**
 * Render a failure, with whatever the error can tell the user.
 *
 * `role="alert"` so a screen reader announces it when it appears. An `ApiError` adds its code, status
 * and request id — that id is what matches the user's report to a server log line.
 *
 * A `details.ticket` gets its own line: the backend answers 501 with the ticket that owns an
 * unimplemented endpoint, so an incomplete feature reads as planned work rather than as a fault.
 *
 * `onRetry` is optional; the button only appears when the caller can actually retry.
 * @param {{ error: unknown, title?: string, onRetry?: () => void }} props
 * @returns {JSX.Element}
 */
export function ErrorState({ error, title = 'Something went wrong', onRetry }) {
  const api = isApiError(error) ? error : null;
  const ticket =
    api && api.details && !Array.isArray(api.details) && typeof api.details.ticket === 'string'
      ? api.details.ticket
      : null;
  return (
    <div role="alert" className="state state--error">
      <p>
        <strong>{title}</strong>
      </p>
      <p>{errorMessage(error)}</p>
      {ticket ? (
        <p>
          Owned by ticket <span className="ticket">{ticket}</span>
        </p>
      ) : null}
      {api ? (
        <p className="meta">
          {api.code} · HTTP {api.status}
          {api.requestId ? ` · request ${api.requestId}` : ''}
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" className="secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
