// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: checkout request list resource hook (the API answers 501 until SCRUM-requests-*)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { useCallback } from 'react';
import * as requestsApi from '../services/requests.api';
import { useApiResource } from './useApiResource';
export function useRequests(params = {}) {
  const { page, limit, state } = params;
  const fetcher = useCallback(
    (signal) => requestsApi.list({ page, limit, state }, signal),
    [page, limit, state],
  );
  return useApiResource(fetcher);
}
