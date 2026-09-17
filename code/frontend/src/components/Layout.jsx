// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: app shell with landmarks, skip link, role-aware navigation, sign-out (NFR-9, NFR-12)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { APP_NAME, ROLE_LABELS, ROLES, ROUTES } from '../utils/constants';
export function Layout() {
  const { user, organization, role, logout } = useAuth();
  const navigate = useNavigate();
  const canApprove = role === ROLES.APPROVER || role === ROLES.ORG_ADMIN;
  const isAdmin = role === ROLES.ORG_ADMIN;
  const onSignOut = async () => {
    await logout();
    navigate(ROUTES.login, { replace: true });
  };
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <Link to={ROUTES.home} className="brand">
          {APP_NAME}
        </Link>
        <nav aria-label="Primary">
          <ul>
            <li>
              <NavLink to={ROUTES.catalog} end>
                Catalog
              </NavLink>
            </li>
            <li>
              <NavLink to={ROUTES.myRequests}>My requests</NavLink>
            </li>
            {canApprove ? (
              <li>
                <NavLink to={ROUTES.approvals}>Approvals</NavLink>
              </li>
            ) : null}
            {isAdmin ? (
              <li>
                <NavLink to={ROUTES.admin} end>
                  Dashboard
                </NavLink>
              </li>
            ) : null}
            {isAdmin ? (
              <li>
                <NavLink to={ROUTES.auditLog}>Audit log</NavLink>
              </li>
            ) : null}
          </ul>
        </nav>
        <div className="session">
          <span>
            {user?.name}
            {organization ? ` · ${organization.name}` : ''}
            {role ? ` · ${ROLE_LABELS[role]}` : ''}
          </span>
          <button type="button" className="secondary" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">{APP_NAME} · CS673 Team 3 · Iteration 1</footer>
    </>
  );
}
