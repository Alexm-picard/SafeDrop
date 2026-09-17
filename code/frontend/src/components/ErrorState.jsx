// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: accessible error panel (role=alert) with code/requestId and optional retry (SCRUM-103 AC2)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { errorMessage, isApiError } from '../services/api';
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
