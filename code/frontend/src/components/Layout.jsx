// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: app shell with landmarks, skip link, role-aware navigation (incl. Members for ORG_ADMIN), sign-out (NFR-9, NFR-12)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; Members link added for the member-lifecycle ticket.

/**
 * The application shell: header, primary navigation, session bar and footer around every signed-in
 * page.
 *
 * Navigation entries are filtered by role — approvals for APPROVER and ORG_ADMIN, dashboard, members and
 * audit log for ORG_ADMIN — which is presentation only. The routes themselves are guarded by `RequireRole`,
 * and the API enforces every permission regardless (SR-1).
 *
 * The accessibility details here are deliberate: a skip link ahead of the navigation, a labelled `nav`
 * landmark, and a focusable `<main>` so that a route change moves focus into the new page rather than
 * leaving it stranded in the header.
 */
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { APP_NAME, ROLE_LABELS, ROLES, ROUTES } from '../utils/constants';
/**
 * Render the shell and the active route inside it.
 *
 * Signing out awaits `logout()` before navigating, so the session is gone before the next page
 * appears; navigating with `replace` keeps a signed-out user from stepping Back into the application.
 * The destination is the landing page rather than the login form: someone who has just left is not
 * necessarily trying to get back in.
 * @returns {JSX.Element}
 */
export function Layout() {
  const { user, organization, role, logout } = useAuth();
  const navigate = useNavigate();
  const canApprove = role === ROLES.APPROVER || role === ROLES.ORG_ADMIN;
  const isAdmin = role === ROLES.ORG_ADMIN;
  const onSignOut = async () => {
    await logout();
    navigate(ROUTES.home, { replace: true });
  };
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <Link to={ROUTES.catalog} className="brand">
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
                <NavLink to={ROUTES.users}>Users</NavLink>
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
