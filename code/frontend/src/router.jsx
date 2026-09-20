// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: route table with RequireAuth/RequireRole guards; createAppRouter for the browser, `routes` for tests; /admin/members
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; members route added for the member-lifecycle ticket.

/**
 * The route table: every URL the SPA serves, and the guards wrapped around them.
 *
 * The nesting is the access model. `/login` and `/setup` sit outside everything, since they are
 * reachable without a session. Everything else is inside `RequireAuth` (a session is needed) and then
 * `Layout` (the shell with navigation). Within that, `RequireRole` wraps the admin areas: the approval
 * queue for APPROVER and ORG_ADMIN, the dashboard, members and audit log for ORG_ADMIN alone.
 *
 * Those role checks are **usability only** — they keep people out of pages that would only show them
 * errors. They are not security. Every API route enforces its own permission server-side (SR-1), so a
 * user who edits their way past a guard reaches a page whose requests all fail with 403.
 *
 * The table is exported separately from the router so tests can mount routes with a memory router.
 */
import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { RequireRole } from './components/RequireRole';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { ApprovalQueuePage } from './pages/ApprovalQueuePage';
import { AssetDetailPage } from './pages/AssetDetailPage';
import { AssetFormPage } from './pages/AssetFormPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { CatalogPage } from './pages/CatalogPage';
import { LoginPage } from './pages/LoginPage';
import { MembersPage } from './pages/MembersPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrgSetupPage } from './pages/OrgSetupPage';
/**
 * The route tree, from public pages down to role-gated admin areas.
 *
 * The catch-all `*` is last, so an unknown URL renders NotFoundPage instead of matching nothing.
 */
export const routes = [
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <OrgSetupPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <CatalogPage /> },
          { path: 'assets/:id', element: <AssetDetailPage /> },
          { path: 'requests', element: <MyRequestsPage /> },
          {
            element: <RequireRole roles={['APPROVER', 'ORG_ADMIN']} />,
            children: [{ path: 'admin/approvals', element: <ApprovalQueuePage /> }],
          },
          {
            element: <RequireRole roles={['ORG_ADMIN']} />,
            children: [
              { path: 'admin', element: <AdminDashboardPage /> },
              { path: 'admin/users', element: <MembersPage /> },
              { path: 'admin/audit', element: <AuditLogPage /> },
              // Asset writing is ORG_ADMIN-only (`assets:write`), so both forms sit inside this
              // guard. Edit keeps the asset's own URL prefix so the page it edits is obvious.
              { path: 'admin/assets/new', element: <AssetFormPage /> },
              { path: 'assets/:id/edit', element: <AssetFormPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
/**
 * Build the browser router from the route table.
 *
 * Separate from `routes` so tests can use a memory router over the same definitions, and called once
 * from App.
 * @returns {import('react-router').Router}
 */
export function createAppRouter() {
  return createBrowserRouter(routes);
}
