// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: route table with RequireAuth/RequireRole guards; createAppRouter for the browser, `routes` for tests
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { RequireRole } from './components/RequireRole';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { ApprovalQueuePage } from './pages/ApprovalQueuePage';
import { AssetDetailPage } from './pages/AssetDetailPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { CatalogPage } from './pages/CatalogPage';
import { LoginPage } from './pages/LoginPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrgSetupPage } from './pages/OrgSetupPage';
/** Role gating here is usability only; every API route enforces its own permission (SR-1). */
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
              { path: 'admin/audit', element: <AuditLogPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
export function createAppRouter() {
  return createBrowserRouter(routes);
}
