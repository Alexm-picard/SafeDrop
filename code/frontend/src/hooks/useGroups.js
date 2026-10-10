// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-150 ticket)
// AI-Assisted Areas: data hooks for the organisation's user groups and for one group (SCRUM-150, SCRUM-167)
// Human Contributions: reviewed and approved by Mateus Silva (PR #60, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Follows useMembers.js and useAssets.js. Verified through AssetFormPage.test.jsx, GroupsPage.test.jsx and GroupDetailPage.test.jsx. Reviewed before merge; see Human Contributions.

/**
 * Data hooks for the organisation's user groups (SCRUM-149): the list, read by the asset form's group
 * picker (SCRUM-150) and the Groups screen (SCRUM-167), and one group with its members.
 */
import { useCallback } from 'react';
import * as groupsApi from '../services/groups.api';
import { useApiResource } from './useApiResource';

/**
 * Load one page of groups.
 *
 * `page` and `limit` are destructured before use as dependencies: `params` is an object literal at the
 * call site, and a new reference each render would make the fetcher — and the request — new each render.
 * @param {{ page?: number, limit?: number }} [params]
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useGroups(params = {}) {
  const { page, limit } = params;
  const fetcher = useCallback((signal) => groupsApi.list({ page, limit }, signal), [page, limit]);
  return useApiResource(fetcher);
}

/**
 * Load one group with its members resolved.
 * @param {string} id
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useGroup(id) {
  const fetcher = useCallback((signal) => groupsApi.get(id, signal), [id]);
  return useApiResource(fetcher);
}
