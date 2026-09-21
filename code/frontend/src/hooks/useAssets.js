// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: asset list / detail resource hooks (SCRUM-115)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

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
/**
 * Load a page of one asset's chain of custody (SCRUM-29).
 *
 * `page` and `limit` are destructured out before being used as dependencies, for the same reason as
 * `useAssets`: an object literal at the call site is a new reference on every render, and depending
 * on it would refetch the history every time the asset page re-rendered for any reason at all.
 * @param {string} id asset id from the route
 * @param {{ page?: number, limit?: number }} [params]
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useAssetHistory(id, params = {}) {
  const { page, limit } = params;
  const fetcher = useCallback(
    (signal) => assetsApi.history(id, { page, limit }, signal),
    [id, page, limit],
  );
  return useApiResource(fetcher);
}
