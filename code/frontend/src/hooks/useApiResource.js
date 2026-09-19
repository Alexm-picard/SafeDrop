// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: shared async-resource hook (loading/success/error/reload) with abort on unmount and stale-result protection
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The shared data-fetching hook every list and detail page is built on.
 *
 * It turns a fetcher into the four states a page actually needs — loading, success, error, and a way
 * to reload — so no page writes its own effect, its own cancellation or its own error handling. Pages
 * then render `LoadingState`, `ErrorState` or their content from one `status` field.
 *
 * The cancellation it does is the part worth knowing about: a result that arrives after the component
 * unmounted, or after a newer request started, is discarded rather than rendered.
 */
import { useCallback, useEffect, useState } from 'react';
/**
 * Run `fetcher` on mount, whenever it changes, and on demand via `reload()`.
 *
 * `fetcher` must be wrapped in `useCallback` — it is an effect dependency, so a new function on every
 * render would fetch on every render. It receives an `AbortSignal` to pass to the API layer.
 *
 * Two guards keep stale results out of the UI. The effect aborts its request on cleanup, so an
 * in-flight call is cancelled when the component unmounts or the fetcher changes. The local `active`
 * flag then ignores any result that still arrives, because an abort does not retroactively stop a
 * promise that has already resolved — without it, a slow first request could overwrite the data from
 * a faster second one.
 *
 * `reload()` works by incrementing a `tick` that the effect depends on, which re-runs the fetch
 * without needing the fetcher itself to change identity.
 * @param {(signal: AbortSignal) => Promise<unknown>} fetcher memoised fetch function
 * @returns {{ status: 'loading'|'success'|'error', data: unknown, error: unknown, reload: () => void }}
 */
export function useApiResource(fetcher) {
  const [state, setState] = useState({
    status: 'loading',
    data: null,
    error: null,
    tick: 0,
  });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetcher(controller.signal)
      .then((data) => {
        if (active) {
          setState((prev) => ({ ...prev, status: 'success', data, error: null }));
        }
      })
      .catch((error) => {
        if (active && !controller.signal.aborted) {
          setState((prev) => ({ ...prev, status: 'error', data: null, error }));
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [fetcher, state.tick]);
  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading', error: null, tick: prev.tick + 1 }));
  }, []);
  return { status: state.status, data: state.data, error: state.error, reload };
}
