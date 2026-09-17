// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: application root: AuthProvider around the router
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { AuthProvider } from './context/AuthContext';
import { createAppRouter } from './router';
export default function App() {
  const [router] = useState(() => createAppRouter());
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
