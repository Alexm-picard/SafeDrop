// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: render helpers: full app on a memory router (real AuthProvider + MSW) or a component under a fake auth context
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Render helpers for component tests.
 *
 * Two ways to mount, for two kinds of test. `renderApp()` mounts the *real* route table and the real
 * `AuthProvider`, so routing, guards and session bootstrapping are all genuinely exercised — that is
 * what the routing and guard tests need. `renderWithAuth()` mounts a single element under a stubbed
 * auth context with `vi.fn()` operations, which is what a test of one component's behaviour needs.
 *
 * Both use a memory router, so navigation can be asserted on without a browser history.
 */
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { AuthContext } from '../../src/context/auth-context';
import { AuthProvider } from '../../src/context/AuthContext';
import { routes } from '../../src/router';
import { org } from '../mocks/handlers';
/**
 * Mount the real application at `route`.
 *
 * Uses the actual route table from src/router.jsx, so a change to routing or to a guard is reflected
 * here rather than in a parallel copy. The session normally comes from the MSW `/me` handler;
 * passing `initialState` skips that bootstrap for tests that only care about what happens afterwards.
 *
 * The router is returned alongside the render result so a test can assert on the current location.
 * @param {string} [route] initial URL
 * @param {object} [initialState] a ready-made auth state, bypassing the `/me` call
 * @returns {{ router: object } & import('@testing-library/react').RenderResult}
 */
export function renderApp(route = '/', initialState) {
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const utils = render(
    <AuthProvider initialState={initialState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { router, ...utils };
}
/**
 * Build an authenticated auth state for `renderApp`.
 * @param {object} user
 * @param {object} [organization]
 * @returns {{ status: 'authenticated', user: object, organization: object }}
 */
export function authenticatedState(user, organization = org) {
  return { status: 'authenticated', user, organization };
}
/**
 * The signed-out auth state, for rendering the app as a visitor with no session.
 */
export const anonymousState = { status: 'anonymous', user: null, organization: null };
/**
 * Mount `element` under a stubbed auth context.
 *
 * The context value is built from the options: `status` defaults to authenticated when a user is
 * given, and the four operations are `vi.fn()` spies so a test can assert that a component called
 * `logout()` rather than that something logged out. `overrides` replaces any of them — a rejecting
 * `login` for an error-path test, for instance.
 *
 * `extraRoutes` adds destinations so a redirect can be asserted by what renders after it. The context
 * value is returned so the spies can be inspected.
 * @param {React.ReactNode} element the component under test
 * @param {{ user?: object|null, organization?: object, status?: string, route?: string, extraRoutes?: object[], overrides?: object }} [options]
 * @returns {{ router: object, value: object } & import('@testing-library/react').RenderResult}
 */
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
/**
 * A pass-through wrapper component for `renderHook`.
 *
 * Hook tests need a wrapper argument; this supplies one that adds nothing, keeping the hook under
 * test isolated from any provider.
 * @param {{ children: React.ReactNode }} props
 * @returns {JSX.Element}
 */
export function Wrapper({ children }) {
  return <>{children}</>;
}
