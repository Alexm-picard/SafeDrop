// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: member-list resource hook
// Human Contributions: pending team review
// Notes: Same shape as useAuditEvents. Must be reviewed by the owning team member before merge.

/**
 * Data hook for the organisation's member list.
 *
 * Read-only: inviting and changing roles are one-off actions the page performs directly and then
 * follows with `reload()`, so there is no mutation state to hold here.
 */
import { useCallback } from 'react';
import * as usersApi from '../services/users.api';
import { useApiResource } from './useApiResource';

/**
 * Load one page of members.
 *
 * `page` and `limit` are destructured before use as dependencies: `params` is an object literal at the
 * call site, and a new reference each render would make the fetcher — and the request — new each render.
 * @param {{ page?: number, limit?: number }} [params]
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useMembers(params = {}) {
  const { page, limit } = params;
  const fetcher = useCallback((signal) => usersApi.list({ page, limit }, signal), [page, limit]);
  return useApiResource(fetcher);
}
