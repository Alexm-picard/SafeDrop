// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: asset list / detail resource hooks (SCRUM-115)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Data hooks for the asset catalogue.
 *
 * Each one binds an API call to `useApiResource` and memoises the fetcher on the values it actually
 * depends on, so a page re-rendering for an unrelated reason does not refetch.
 */
import { useCallback } from 'react';
import * as assetsApi from '../services/assets.api';
import { useApiResource } from './useApiResource';
/**
 * Load a page of the asset catalogue.
 *
 * The filter values are destructured out of `params` before being used as dependencies: `params` is
 * usually an object literal at the call site, which is a new reference on every render and would make
 * the fetcher — and so the request — new every time.
 * @param {{ page?: number, limit?: number, category?: string, includeRetired?: boolean }} [params]
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useAssets(params = {}) {
  const { page, limit, category, includeRetired } = params;
  const fetcher = useCallback(
    (signal) => assetsApi.list({ page, limit, category, includeRetired }, signal),
    [page, limit, category, includeRetired],
  );
  return useApiResource(fetcher);
}
/**
 * Load one asset with its units.
 * @param {string} id asset id from the route
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useAsset(id) {
  const fetcher = useCallback((signal) => assetsApi.get(id, signal), [id]);
  return useApiResource(fetcher);
}
