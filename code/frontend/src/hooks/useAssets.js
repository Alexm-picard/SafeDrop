// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: asset list / detail resource hooks (the API answers 501 until SCRUM-assets-*)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { useCallback } from 'react';
import * as assetsApi from '../services/assets.api';
import { useApiResource } from './useApiResource';
export function useAssets(params = {}) {
  const { page, limit, category, includeRetired } = params;
  const fetcher = useCallback(
    (signal) => assetsApi.list({ page, limit, category, includeRetired }, signal),
    [page, limit, category, includeRetired],
  );
  return useApiResource(fetcher);
}
export function useAsset(id) {
  const fetcher = useCallback((signal) => assetsApi.get(id, signal), [id]);
  return useApiResource(fetcher);
}
