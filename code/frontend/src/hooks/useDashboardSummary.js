// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: dashboard summary resource hook (SCRUM-103)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { useCallback } from 'react';
import * as dashboardApi from '../services/dashboard.api';
import { useApiResource } from './useApiResource';
export function useDashboardSummary() {
  const fetcher = useCallback((signal) => dashboardApi.summary(signal), []);
  return useApiResource(fetcher);
}
