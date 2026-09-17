// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: AuthProvider: { user, role, orgId, status } populated from GET /api/auth/me on load; login/logout/refresh (SDD §6.2)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as authApi from '../services/auth.api';
import { sessionEvents } from '../services/api';
import { AuthContext } from './auth-context';
const ANONYMOUS = { status: 'anonymous', user: null, organization: null };
export function AuthProvider({ children, initialState }) {
  const [state, setState] = useState(
    initialState ?? { status: 'loading', user: null, organization: null },
  );
  const loadMe = useCallback(async (signal) => {
    try {
      const { user, organization } = await authApi.me(signal);
      if (!signal?.aborted) {
        setState({ status: 'authenticated', user, organization });
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      // Any failure (401 after a failed refresh, network) means "not signed in" for the UI.
      setState(ANONYMOUS);
    }
  }, []);
  useEffect(() => {
    if (initialState) {
      return undefined;
    }
    const controller = new AbortController();
    authApi
      .me(controller.signal)
      .then(({ user, organization }) => {
        if (!controller.signal.aborted) {
          setState({ status: 'authenticated', user, organization });
        }
      })
      .catch(() => {
        // Any failure (401 after a failed refresh, network) means "not signed in" for the UI.
        if (!controller.signal.aborted) {
          setState(ANONYMOUS);
        }
      });
    return () => controller.abort();
  }, [initialState]);
  useEffect(() => {
    const onExpired = () => setState(ANONYMOUS);
    sessionEvents.addEventListener('expired', onExpired);
    return () => sessionEvents.removeEventListener('expired', onExpired);
  }, []);
  const login = useCallback(
    async (credentials) => {
      const { user } = await authApi.login(credentials);
      setState({ status: 'authenticated', user, organization: null });
      // Organization details come from /me; fetch them in the background.
      void loadMe();
      return user;
    },
    [loadMe],
  );
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The API refusing (expired session) still means we are logged out locally.
    } finally {
      setState(ANONYMOUS);
    }
  }, []);
  const refresh = useCallback(() => loadMe(), [loadMe]);
  const setSession = useCallback((user, organization) => {
    setState({ status: 'authenticated', user, organization });
  }, []);
  const value = useMemo(
    () => ({
      ...state,
      role: state.user?.role ?? null,
      orgId: state.user?.orgId ?? null,
      login,
      logout,
      refresh,
      setSession,
    }),
    [state, login, logout, refresh, setSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
