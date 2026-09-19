// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: dashboard summary resource hook (SCRUM-103)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Data hook for the admin dashboard summary.
 */
import { useCallback } from 'react';
import * as dashboardApi from '../services/dashboard.api';
import { useApiResource } from './useApiResource';
/**
 * Load the organisation's summary counts.
 *
 * The fetcher has an empty dependency list — the call takes no parameters, so it is created once and
 * fires exactly one request per mount.
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useDashboardSummary() {
  const fetcher = useCallback((signal) => dashboardApi.summary(signal), []);
  return useApiResource(fetcher);
}
