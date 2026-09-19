// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: AuthProvider: { user, role, orgId, status } populated from GET /api/auth/me on load; login/logout/refresh (SDD §6.2)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The session: who is signed in, and the operations that change that.
 *
 * The SPA holds no token — the session lives in `httpOnly` cookies the browser attaches automatically —
 * so "am I signed in?" is answered by asking the API. `GET /api/auth/me` runs on mount and settles the
 * state into `authenticated` or `anonymous`; `loading` in between is what route guards wait on, so a
 * one-frame redirect to the login page cannot happen before the answer arrives.
 *
 * Every failure resolves to anonymous rather than an error state. A 401 after a failed refresh and a
 * network outage mean the same thing to the UI: show the login page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as authApi from '../services/auth.api';
import { sessionEvents } from '../services/api';
import { AuthContext } from './auth-context';
/**
 * The signed-out state. A shared frozen-in-practice constant so every path that logs out produces
 * exactly the same shape.
 */
const ANONYMOUS = { status: 'anonymous', user: null, organization: null };
/**
 * Provide the session and its operations to the tree.
 *
 * Three effects run here. The first resolves the session on mount, skipped when `initialState` is
 * supplied (tests render an already-authenticated tree without a network round trip). The second
 * listens for the `expired` event from services/api.js, so a session that dies mid-use drops the UI
 * to anonymous wherever it happens. Both abort or unsubscribe on unmount, and the fetch result is
 * discarded if the signal aborted — otherwise React's StrictMode double-mount would set state on an
 * unmounted tree.
 *
 * The operations it exposes:
 *  - `login(credentials)` — authenticate, then load the organisation in the background so the form
 *    can navigate immediately rather than waiting on a second round trip;
 *  - `logout()` — end the session; a failing API call still logs out locally, since refusing to log
 *    someone out because the server said no is the wrong failure mode;
 *  - `refresh()` — re-read `/me`, after a change that affects the current user;
 *  - `setSession(user, organization)` — adopt a session the caller already has, used by the org-setup
 *    page, whose response includes both.
 *
 * The context value is memoised, and `role` and `orgId` are lifted out of `user` so consumers can
 * read them without optional chaining.
 * @param {{ children: React.ReactNode, initialState?: object }} props
 * @returns {JSX.Element}
 */
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
