// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-206 story)
// AI-Assisted Areas: fire-and-forget telemetry write that can never fail a search (AT-6); admin summary with rates (AT-4)
// Human Contributions: pending review
// Notes: Written for SCRUM-206. Must be reviewed and tested by the owning team member before merge.

/**
 * How AI search is behaving, per organisation (SCRUM-206).
 *
 * The write side, `recordSearch()`, is the only code that writes `SearchQueryLog`, and it lives in
 * services/ai/ beside the search it measures — the same folder rule as every Foundry call, `orgId`
 * first. The read side, `summarize()`, is what `GET /api/search-telemetry` returns to an org admin.
 *
 * **Telemetry can never break a search (AT-6).** `recordSearch()` starts the write and returns
 * without waiting for it, and a failed write is caught and logged. This is deliberately the opposite
 * of the audit rule (OD-2), where a change and its audit row commit together or not at all: a search
 * changes nothing, so losing one metric must not cost a member their results.
 *
 * Exports: `recordSearch(orgId, row)`, `summarize(orgId, filters)`.
 */
import * as searchLogRepo from '../../repositories/searchQueryLog.repository.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ component: 'search-telemetry' });

/** The default summary window when the caller gives none: the last 30 days. */
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Record one search, without waiting and without ever throwing.
 *
 * Returns `undefined`, not the write's promise, so a caller cannot accidentally `await` it into the
 * request path. Both an asynchronous rejection and a synchronous throw are caught. The log line names
 * the org and the error's class only — never the row's values or the error message, which for a
 * validation error can quote the document back.
 * @param {string} orgId
 * @param {{ kind: string, assetId?: string|null, aiAssisted: boolean, fallbackReason: string|null, latencyMs: number, candidateCount: number, resultCount: number }} row
 * @returns {void}
 */
export function recordSearch(orgId, row) {
  const failed = (err) =>
    log.warn({ orgId, errorName: err?.name ?? 'Error' }, 'search telemetry write failed');
  try {
    Promise.resolve(searchLogRepo.append(orgId, row)).catch(failed);
  } catch (err) {
    failed(err);
  }
}

/**
 * Summarise the caller's organisation's searches (AT-4).
 *
 * `orgId` is the caller's own, from `scopeTenant` and never from the request (SR-2), and it is the
 * repository's first filter, so another tenant's rows cannot be counted. Who may call this at all is
 * settled by the route's `audit:read` permission, so there is no role logic here.
 *
 * Rates are fractions between 0 and 1, and `null` when there were no searches — "no data" is not the
 * same thing as "0% fell back".
 * @param {string} orgId the caller's organisation, from the access token
 * @param {{ from?: Date, to?: Date, kind?: string }} [filters]
 * @param {{ now?: Date }} [options] injectable clock for tests
 */
export async function summarize(orgId, { from, to, kind } = {}, { now = new Date() } = {}) {
  const end = to ?? now;
  const start = from ?? new Date(end.getTime() - DEFAULT_WINDOW_MS);
  const stats = await searchLogRepo.summarize(orgId, { from: start, to: end, kind });
  const fallbackTotal = Object.values(stats.fallbacks).reduce((sum, n) => sum + n, 0);
  const rate = (n) => (stats.total === 0 ? null : n / stats.total);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    kind: kind ?? null,
    total: stats.total,
    aiAssisted: stats.aiAssisted,
    fallbacks: stats.fallbacks,
    fallbackRate: rate(fallbackTotal),
    zeroResults: stats.zeroResults,
    zeroResultRate: rate(stats.zeroResults),
    latencyMs: stats.latencyMs,
  };
}
