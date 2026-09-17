// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: render helpers: full app on a memory router (real AuthProvider + MSW) or a component under a fake auth context
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { AuthContext } from '../../src/context/auth-context';
import { AuthProvider } from '../../src/context/AuthContext';
import { routes } from '../../src/router';
import { org } from '../mocks/handlers';
/** Render the real route table at `route` with the real AuthProvider (session comes from MSW /me). */
export function renderApp(route = '/', initialState) {
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const utils = render(
    <AuthProvider initialState={initialState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { router, ...utils };
}
export function authenticatedState(user, organization = org) {
  return { status: 'authenticated', user, organization };
}
export const anonymousState = { status: 'anonymous', user: null, organization: null };
/** Render `element` (or a small route table) under a stubbed auth context. */
export function renderWithAuth(
  element,
  { user = null, organization = org, status, route = '/', extraRoutes = [], overrides = {} } = {},
) {
  const value = {
    status: status ?? (user ? 'authenticated' : 'anonymous'),
    user,
    organization: user ? organization : null,
    role: user?.role ?? null,
    orgId: user?.orgId ?? null,
    login: vi.fn(),
    logout: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    setSession: vi.fn(),
    ...overrides,
  };
  const router = createMemoryRouter([{ path: '/', element }, ...extraRoutes], {
    initialEntries: [route],
  });
  const utils = render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return { router, value, ...utils };
}
export function Wrapper({ children }) {
  return <>{children}</>;
}
