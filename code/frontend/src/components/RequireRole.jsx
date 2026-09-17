// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: role guard (usability only: the API enforces permissions server-side, SR-1)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { ROUTES } from '../utils/constants';
export function RequireRole({ roles, children }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) {
    return <Navigate to={ROUTES.home} replace state={{ denied: true }} />;
  }
  return children ?? <Outlet />;
}
