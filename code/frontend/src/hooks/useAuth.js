// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: useAuth hook
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Access to the session context.
 */
import { useContext } from 'react';
import { AuthContext } from '../context/auth-context';
/**
 * Read the auth context.
 *
 * Throws when used outside `<AuthProvider>`, rather than returning null. A component that silently
 * received no session would render as if signed out, which is a confusing bug; an explicit error
 * names the real mistake.
 * @returns {{ status: string, user: object|null, organization: object|null, role: string|null, orgId: string|null, login: Function, logout: Function, refresh: Function, setSession: Function }}
 * @throws {Error} when there is no AuthProvider above
 */
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
