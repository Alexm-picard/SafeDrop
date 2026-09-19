// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: checkout request list resource hook, including the own-vs-org scope switch (SCRUM-requests-list)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Data hook for checkout requests.
 */
import { useCallback } from 'react';
import * as requestsApi from '../services/requests.api';
import { useApiResource } from './useApiResource';
/**
 * Load a page of checkout requests, optionally filtered by state and scope.
 *
 * Serves both the member's own list (no `scope`, or `scope: 'own'`) and the org-wide approval queue
 * (`scope: 'org'`) — the API still decides what the caller is actually allowed to see, so this hook
 * only forwards what the page asked for.
 * @param {{ page?: number, limit?: number, state?: string, scope?: 'own'|'org' }} [params]
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useRequests(params = {}) {
  const { page, limit, state, scope } = params;
  const fetcher = useCallback(
    (signal) => requestsApi.list({ page, limit, state, scope }, signal),
    [page, limit, state, scope],
  );
  return useApiResource(fetcher);
}
