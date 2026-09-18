// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: checkout request list resource hook (the API answers 501 until SCRUM-requests-*)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Data hook for checkout requests.
 */
import { useCallback } from 'react';
import * as requestsApi from '../services/requests.api';
import { useApiResource } from './useApiResource';
/**
 * Load a page of checkout requests, optionally filtered by state.
 *
 * Serves both the member's own list and the approval queue (`state: 'PENDING'`) — the API decides
 * which requests the caller may see, so one hook covers both.
 * @param {{ page?: number, limit?: number, state?: string }} [params]
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useRequests(params = {}) {
  const { page, limit, state } = params;
  const fetcher = useCallback(
    (signal) => requestsApi.list({ page, limit, state }, signal),
    [page, limit, state],
  );
  return useApiResource(fetcher);
}
