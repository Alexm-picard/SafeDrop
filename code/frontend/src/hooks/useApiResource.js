// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: shared async-resource hook (loading/success/error/reload) with abort on unmount and stale-result protection
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { useCallback, useEffect, useState } from 'react';
/**
 * Run `fetcher` on mount and whenever it changes (wrap it in useCallback). The fetcher receives an
 * AbortSignal; results that arrive after unmount or after a newer request are ignored.
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
