// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: 404 page
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { Link } from 'react-router';
import { ROUTES } from '../utils/constants';
export function NotFoundPage() {
  return (
    <main id="main" className="auth-page">
      <h1>Page not found</h1>
      <p>
        <Link to={ROUTES.home}>Back to the catalog</Link>
      </p>
    </main>
  );
}
