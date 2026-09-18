// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: route guard: loading → LoadingState, anonymous → /login (remembering where the user was)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Route guard: a session is required below this point.
 *
 * Wraps every route except login and setup. This is usability, not security — it keeps signed-out
 * visitors off pages that would only show them errors, while the API refuses unauthenticated requests
 * regardless (SR-1).
 */
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { ROUTES } from '../utils/constants';
import { LoadingState } from './LoadingState';
/**
 * Render the child route, a loading state, or a redirect to login.
 *
 * The `loading` case must be handled, not treated as signed out: on a fresh page load the session is
 * still being resolved, and redirecting on that first frame would bounce an authenticated user to the
 * login page every time they refreshed.
 *
 * The attempted path is carried along in navigation state so the login page can return the user
 * there, and `replace` keeps the guarded URL out of history.
 * @returns {JSX.Element}
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return <LoadingState label="Checking your session…" />;
  }
  if (status === 'anonymous') {
    return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
