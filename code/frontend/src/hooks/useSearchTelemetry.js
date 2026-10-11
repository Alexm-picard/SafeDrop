// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: data hook for the dashboard's AI search card (SCRUM-206 AT-4)
// Human Contributions: feature choice and scope by Amber Rastella; reviewer recorded on the PR
// Notes: Same shape as useDashboardSummary.

/**
 * Data hook for the AI search summary on the admin dashboard.
 */
import { useCallback } from 'react';
import * as searchTelemetryApi from '../services/searchTelemetry.api';
import { useApiResource } from './useApiResource';

/**
 * Load the organisation's AI search summary. One request per mount: the call takes no parameters.
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useSearchTelemetry() {
  const fetcher = useCallback((signal) => searchTelemetryApi.summary(signal), []);
  return useApiResource(fetcher);
}
