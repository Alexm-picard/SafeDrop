// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: role guard (usability only: the API enforces permissions server-side, SR-1)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Route guard: this area is for particular roles.
 *
 * Presentation only. A user who reaches a guarded page anyway finds every request on it refused with
 * 403 by the API, which is where authorization actually lives (SR-1).
 */
import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { ROUTES } from '../utils/constants';
/**
 * Render the protected content when the caller's role is in `roles`, otherwise redirect home.
 *
 * Works both as a layout route (rendering an `<Outlet/>`) and as a wrapper around explicit children,
 * so a single page can be guarded without adding a route level. The redirect carries `denied` in
 * navigation state so the destination can explain what happened rather than silently appearing.
 * @param {{ roles: string[], children?: React.ReactNode }} props
 * @returns {JSX.Element}
 */
export function RequireRole({ roles, children }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) {
    return <Navigate to={ROUTES.home} replace state={{ denied: true }} />;
  }
  return children ?? <Outlet />;
}
