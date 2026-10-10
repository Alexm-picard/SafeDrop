// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: app shell with landmarks, skip link, role-aware navigation (incl. Members, Groups (SCRUM-167) and Settings (SCRUM-148) for ORG_ADMIN), sign-out (NFR-9, NFR-12); UI rework: two-line session block; SCRUM-241 redesign: the pegboard side rail, Primary and Manage navigation, top bar with breadcrumb and the ⌘K palette, phone tab bar with a More sheet
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; Members link added for the member-lifecycle ticket.

/**
 * The application shell: a side rail with the navigation and the session, a top bar with where you
 * are and a "jump to" palette, and the page itself.
 *
 * Navigation entries are filtered by role — the overview, users, groups, audit log and settings for
 * ORG_ADMIN; Requests opens the organisation-wide board for APPROVER and ORG_ADMIN and the member's
 * own list for everyone else — which is presentation only. The routes themselves are guarded by
 * `RequireRole`, and the API enforces every permission regardless (SR-1).
 *
 * The accessibility details here are deliberate: a skip link ahead of the navigation, labelled `nav`
 * landmarks, and a focusable `<main>` so that a route change moves focus into the new page rather than
 * leaving it stranded in the rail.
 *
 * SCRUM-241. On a phone the rail becomes a tab bar along the bottom (Overview, Catalog, Requests and
 * More); More opens a sheet with the Manage links and the session. The same elements serve both
 * layouts, so nothing is rendered twice.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { APP_NAME, ROLE_LABELS, ROLES, ROUTES } from '../utils/constants';
import { CommandPalette } from './CommandPalette';

/**
 * Which section a path belongs to: the key of the nav entry to mark current, and the label for the
 * breadcrumb. Detail and form pages belong to the list they came from.
 * @param {string} pathname
 * @param {boolean} canApprove
 * @returns {{ key: string, label: string }}
 */
function sectionOf(pathname, canApprove) {
  const requestsLabel = canApprove ? 'Requests' : 'My requests';
  if (pathname === ROUTES.admin) return { key: 'overview', label: 'Overview' };
  if (pathname.startsWith(ROUTES.approvals) || pathname.startsWith(ROUTES.myRequests)) {
    return { key: 'requests', label: requestsLabel };
  }
  if (pathname.startsWith(ROUTES.users)) return { key: 'users', label: 'Users' };
  if (pathname.startsWith(ROUTES.groups)) return { key: 'groups', label: 'Groups' };
  if (pathname.startsWith(ROUTES.auditLog)) return { key: 'audit', label: 'Audit log' };
  if (pathname.startsWith(ROUTES.settings)) return { key: 'settings', label: 'Settings' };
  return { key: 'catalog', label: 'Catalog' };
}

/**
 * One link in the rail. `aria-current` is worked out by the shell rather than by NavLink, because a
 * section owns more than one path (the Requests entry is current on a request's own page too).
 * @param {{ to: string, current: boolean, children: React.ReactNode }} props
 * @returns {JSX.Element}
 */
function RailLink({ to, current, children }) {
  return (
    <li>
      <Link to={to} aria-current={current ? 'page' : undefined}>
        <span className="tab-dot" aria-hidden="true" />
        {children}
      </Link>
    </li>
  );
}

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
  const { pathname } = useLocation();
  const canApprove = role === ROLES.APPROVER || role === ROLES.ORG_ADMIN;
  const isAdmin = role === ROLES.ORG_ADMIN;
  const orgLine = [organization?.name, role ? ROLE_LABELS[role] : null].filter(Boolean).join(' · ');
  const section = sectionOf(pathname, canApprove);
  // The More sheet belongs to the page it was opened on: remembering that path (rather than a
  // boolean) closes it whenever the page changes, so following one of its links leaves it shut.
  const [moreOpenOn, setMoreOpenOn] = useState(null);
  const moreOpen = moreOpenOn === pathname;
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Ctrl+K opens the palette from anywhere; Escape closes the More sheet.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === 'Escape') {
        setMoreOpenOn(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const onSignOut = async () => {
    await logout();
    navigate(ROUTES.home, { replace: true });
  };

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <header className="rail" data-more={moreOpen ? 'open' : undefined}>
          <Link to={ROUTES.catalog} className="brand">
            {APP_NAME}
          </Link>
          <nav aria-label="Primary" className="rail-primary">
            <ul className="rail-group">
              {isAdmin ? (
                <RailLink to={ROUTES.admin} current={section.key === 'overview'}>
                  Overview
                </RailLink>
              ) : null}
              <RailLink to={ROUTES.catalog} current={section.key === 'catalog'}>
                Catalog
              </RailLink>
              <RailLink
                to={canApprove ? ROUTES.approvals : ROUTES.myRequests}
                current={section.key === 'requests'}
              >
                {canApprove ? 'Requests' : 'My requests'}
              </RailLink>
            </ul>
          </nav>
          <button
            type="button"
            className="bare more-toggle"
            aria-expanded={moreOpen}
            aria-controls="rail-sheet"
            onClick={() => setMoreOpenOn(moreOpen ? null : pathname)}
          >
            <span className="tab-dot" aria-hidden="true" />
            More
          </button>
          <div className="rail-sheet" id="rail-sheet">
            {isAdmin ? (
              <nav aria-labelledby="manage-heading" className="rail-manage">
                <h2 id="manage-heading" className="rail-heading">
                  Manage
                </h2>
                <ul className="rail-group">
                  <RailLink to={ROUTES.users} current={section.key === 'users'}>
                    Users
                  </RailLink>
                  <RailLink to={ROUTES.groups} current={section.key === 'groups'}>
                    Groups
                  </RailLink>
                  <RailLink to={ROUTES.auditLog} current={section.key === 'audit'}>
                    Audit log
                  </RailLink>
                  <RailLink to={ROUTES.settings} current={section.key === 'settings'}>
                    Settings
                  </RailLink>
                </ul>
              </nav>
            ) : null}
            <div className="session">
              <span className="session-user">
                <strong title={user?.name}>{user?.name}</strong>
                <span title={orgLine}>{orgLine}</span>
              </span>
              <div className="session-actions">
                <Link className="button secondary small" to={ROUTES.changePassword}>
                  Change password
                </Link>
                <button type="button" className="secondary small" onClick={onSignOut}>
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </header>
        <div className="workspace">
          <div className="topbar">
            <Link to={ROUTES.catalog} className="brand topbar-brand">
              {APP_NAME}
            </Link>
            <p className="crumbs">
              {organization?.name ? `${organization.name} / ` : ''}
              <strong>{section.label}</strong>
            </p>
            <button
              type="button"
              className="bare jump"
              aria-haspopup="dialog"
              onClick={() => setPaletteOpen(true)}
            >
              Search or jump to…
              <kbd aria-hidden="true">⌘K</kbd>
            </button>
          </div>
          <main id="main" tabIndex={-1}>
            <Outlet />
          </main>
          <footer className="app-footer">{APP_NAME} · CS673 Team 3</footer>
        </div>
      </div>
      {paletteOpen ? <CommandPalette role={role} onClose={closePalette} /> : null}
    </>
  );
}
