// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: the Overview's AI search notice, shown only when something needs attention (SCRUM-242)
// Human Contributions: feature choice and placement by Amber Rastella; reviewer recorded on the PR
// Notes: Shares aiSearchStatus with the AI search page.

/**
 * The Overview's only trace of AI search: a notice, shown when `aiSearchStatus` says something needs
 * the admin's attention, linking to the AI search page (SCRUM-242).
 *
 * On a normal day it renders nothing, which is the point. The Overview is the admin's task list, and a
 * monitoring panel that usually says "fine" made it read as cluttered. While the figures load, and if
 * they fail to, it also renders nothing: a missing warning here is not worth an error on the page that
 * holds the admin's actual work, and the AI search page shows the failure properly.
 */
import { Link } from 'react-router';
import { useSearchTelemetry } from '../hooks/useSearchTelemetry';
import { aiSearchStatus } from '../utils/aiSearchStatus';
import { ROUTES } from '../utils/constants';

/**
 * Render the notice, or nothing.
 * @returns {JSX.Element|null}
 */
export function AiSearchAlert() {
  const { data } = useSearchTelemetry();
  if (!data) {
    return null;
  }
  const state = aiSearchStatus(data);
  if (!state.needsAttention) {
    return null;
  }
  return (
    <div className="notice notice--warn notice--inline ai-alert">
      <p>
        <strong>{state.title}.</strong> {state.detail}
      </p>
      <Link className="button secondary small" to={ROUTES.aiSearch}>
        View AI search
      </Link>
    </div>
  );
}
