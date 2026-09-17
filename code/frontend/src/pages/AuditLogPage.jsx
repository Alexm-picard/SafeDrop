// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: audit log placeholder wired to GET /api/audit (SCRUM-audit-log)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { useCallback } from 'react';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { TicketPlaceholder } from '../components/TicketPlaceholder';
import { useApiResource } from '../hooks/useApiResource';
import * as auditApi from '../services/audit.api';
import { TICKETS } from '../utils/constants';
import { pluralize } from '../utils/format';
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
