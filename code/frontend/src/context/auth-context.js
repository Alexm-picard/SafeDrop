// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: auth context object and its value shape (kept out of the .tsx so react-refresh only sees components there)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The auth React context object, on its own.
 *
 * Separated from AuthContext.jsx because Vite's fast refresh only preserves component state when a
 * module exports components exclusively. Keeping the context here lets the provider file export just
 * its component, and lets `useAuth` import the context without pulling in the provider.
 */
import { createContext } from 'react';
export const AuthContext = createContext(null);
