/**
 * Data hook for the audit trail.
 *
 * Read-only, because the API is: there is no mutation hook here and no endpoint to back one (SR-8).
 */
import { useCallback } from 'react';
import * as auditApi from '../services/audit.api';
import { useApiResource } from './useApiResource';
/**
 * Load a page of the organisation's audit trail, newest first.
 *
 * The filter values are destructured out of `params` before being used as dependencies: `params` is an
 * object literal at the call site, so a new reference on every render would make the fetcher — and
 * therefore the request — new on every render too.
 *
 * Undefined filters are dropped by the API layer rather than sent as empty strings, which matters
 * here: the route validates `action` and `targetType` against a Zod enum, so `?action=` would be a
 * 400 rather than "no filter".
 * @param {{ page?: number, limit?: number, action?: string, targetType?: string, targetId?: string, actorId?: string, from?: string, to?: string }} [params]
 * @returns {{ status: string, data: unknown, error: unknown, reload: () => void }}
 */
export function useAuditEvents(params = {}) {
  const { page, limit, action, targetType, targetId, actorId, from, to } = params;
  const fetcher = useCallback(
    (signal) =>
      auditApi.list({ page, limit, action, targetType, targetId, actorId, from, to }, signal),
    [page, limit, action, targetType, targetId, actorId, from, to],
  );
  return useApiResource(fetcher);
}
