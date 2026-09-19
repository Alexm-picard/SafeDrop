// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: application root: AuthProvider around the router
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The application root: the providers every page runs inside.
 *
 * `AuthProvider` wraps `RouterProvider`, so the session is resolved before any route renders and route
 * guards can read it from context.
 */
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { AuthProvider } from './context/AuthContext';
import { createAppRouter } from './router';
/**
 * Render the provider tree.
 *
 * The router is created inside a lazy `useState` initialiser so it is built exactly once. Building it
 * during render would produce a new router on every re-render, resetting navigation history and
 * unmounting the current page.
 * @returns {JSX.Element}
 */
export default function App() {
  const [router] = useState(() => createAppRouter());
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
