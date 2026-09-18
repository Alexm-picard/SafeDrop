// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: audit log placeholder wired to GET /api/audit (SCRUM-audit-log)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The audit log (ORG_ADMIN only).
 *
 * Read-only, permanently: the API offers no way to edit or delete an event, and the model refuses
 * every mutating operation (SR-8). The placeholder text says so, because "cannot be edited" is the
 * point of the feature rather than an incidental detail.
 */
import { useCallback } from 'react';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { TicketPlaceholder } from '../components/TicketPlaceholder';
import { useApiResource } from '../hooks/useApiResource';
import * as auditApi from '../services/audit.api';
import { TICKETS } from '../utils/constants';
import { pluralize } from '../utils/format';
/**
 * Render the audit log.
 *
 * Uses `useApiResource` directly rather than a dedicated hook, since this is the only screen reading
 * the audit API. The fetcher is memoised with an empty dependency list so it is created once and
 * fires a single request per mount.
 * @returns {JSX.Element}
 */
export function AuditLogPage() {
  const fetcher = useCallback((signal) => auditApi.list({}, signal), []);
  const { status, data, error, reload } = useApiResource(fetcher);
  return (
    <>
      <h1>Audit log</h1>
      <TicketPlaceholder ticket={TICKETS.auditLog}>
        Every request, approval, checkout, return and inventory change is recorded and can never be
        edited or deleted.
      </TicketPlaceholder>
      {status === 'loading' ? <LoadingState label="Loading audit events…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the audit log" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? <p>{pluralize(data.total, 'event')}</p> : null}
    </>
  );
}
