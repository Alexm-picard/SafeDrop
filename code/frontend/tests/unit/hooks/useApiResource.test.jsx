// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: resource hook tests: loading→success, error, reload, stale results ignored after unmount
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for the shared data-fetching hook.
 *
 * The two happy paths (loading → success, loading → error with a working `reload()`) and the one that
 * prevents a real bug: a result arriving after unmount must be ignored and the signal aborted.
 * Without that, React logs a state-update-on-unmounted-component warning and a slow response can
 * overwrite fresher data.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApiResource } from '../../../src/hooks/useApiResource';
describe('useApiResource', () => {
  it('goes loading → success and exposes data', async () => {
    const fetcher = vi.fn(async (_signal) => ({ n: 1 }));
    const { result } = renderHook(() => useApiResource(fetcher));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual({ n: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });
  it('goes loading → error and reload() fetches again', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('boom');
      }
      return { n: attempt };
    });
    const { result } = renderHook(() => useApiResource(fetcher));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error.message).toBe('boom');
    act(() => result.current.reload());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual({ n: 2 });
  });
  it('ignores a result that arrives after unmount and aborts the signal', async () => {
    let resolve = () => {};
    let signal;
    const fetcher = vi.fn(
      (s) =>
        new Promise((r) => {
          signal = s;
          resolve = r;
        }),
    );
    const { result, unmount } = renderHook(() => useApiResource(fetcher));
    unmount();
    expect(signal?.aborted).toBe(true);
    resolve({ n: 9 });
    await Promise.resolve();
    expect(result.current.status).toBe('loading');
  });
});
