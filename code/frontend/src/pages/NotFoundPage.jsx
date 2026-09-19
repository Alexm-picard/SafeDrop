// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: 404 page
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The catch-all 404 page for an unrecognised URL.
 *
 * Outside the authenticated layout, so it renders for signed-out visitors too — which is why it
 * provides its own `<main>` landmark instead of relying on the shell's.
 */
import { Link } from 'react-router';
import { ROUTES } from '../utils/constants';
/**
 * Render the not-found message with a way back to the catalogue.
 * @returns {JSX.Element}
 */
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
