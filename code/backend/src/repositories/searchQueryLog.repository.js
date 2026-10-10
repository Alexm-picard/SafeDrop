// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-206 story)
// AI-Assisted Areas: append one telemetry row; tenant-scoped aggregate summary (SCRUM-206 AT-1, AT-4)
// Human Contributions: pending review
// Notes: Written for SCRUM-206. Must be reviewed and tested by the owning team member before merge.

/**
 * Data access for `searchquerylogs` — append a row, and summarise one organisation's rows.
 *
 * There is no function that returns individual rows, and none to update or delete. Admins see
 * aggregates only (AT-4), and old rows are removed by the TTL index rather than by application code
 * (AT-5), so neither is needed — and a function that does not exist cannot be misused.
 *
 * Exports: `append(orgId, row)`, `summarize(orgId, filters)`.
 */
import mongoose from 'mongoose';
import { SearchQueryLog } from '../models/SearchQueryLog.js';
import { SEARCH_FALLBACK_REASON_LIST } from '../utils/constants.js';

/**
 * Append one telemetry row.
 *
 * The fields are copied by name, so whatever else is on `row` never reaches the database.
 * @param {string} orgId
 * @param {{ kind: string, assetId?: string|null, aiAssisted: boolean, fallbackReason: string|null, latencyMs: number, candidateCount: number, resultCount: number }} row
 * @returns {Promise<object>}
 */
export async function append(orgId, row) {
  return SearchQueryLog.create({
    orgId,
    kind: row.kind,
    assetId: row.assetId ?? null,
    aiAssisted: row.aiAssisted,
    fallbackReason: row.fallbackReason,
    latencyMs: row.latencyMs,
    candidateCount: row.candidateCount,
    resultCount: row.resultCount,
  });
}

/**
 * Counts and latency for one organisation's searches in `[from, to]`.
 *
 * `orgId` is the first `$match` condition and is cast explicitly: aggregation pipelines bypass
 * Mongoose's casting, so a string would match nothing — or, if this were ever written as an optional
 * filter, everything. One pipeline with `$facet` so the totals and the per-reason counts describe the
 * same snapshot of rows.
 * @param {string} orgId
 * @param {{ from: Date, to: Date, kind?: string }} filters
 * @returns {Promise<{ total: number, aiAssisted: number, zeroResults: number, fallbacks: Record<string, number>, latencyMs: { avg: number|null, p50: number|null, p95: number|null, max: number|null } }>}
 */
export async function summarize(orgId, { from, to, kind }) {
  const match = {
    orgId: new mongoose.Types.ObjectId(String(orgId)),
    timestamp: { $gte: from, $lte: to },
  };
  if (kind) {
    match.kind = kind;
  }
  const [result] = await SearchQueryLog.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              aiAssisted: { $sum: { $cond: ['$aiAssisted', 1, 0] } },
              zeroResults: { $sum: { $cond: [{ $eq: ['$resultCount', 0] }, 1, 0] } },
              avg: { $avg: '$latencyMs' },
              max: { $max: '$latencyMs' },
              // `$percentile` needs MongoDB 7.0+, which docker-compose and the test server both run.
              percentiles: {
                $percentile: { input: '$latencyMs', p: [0.5, 0.95], method: 'approximate' },
              },
            },
          },
        ],
        byReason: [
          { $match: { fallbackReason: { $ne: null } } },
          { $group: { _id: '$fallbackReason', count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const totals = result?.totals?.[0];
  // Every reason is present, zero or not, so the client never has to guess whether a missing key
  // means "none" or "not tracked".
  const fallbacks = Object.fromEntries(SEARCH_FALLBACK_REASON_LIST.map((reason) => [reason, 0]));
  for (const { _id, count } of result?.byReason ?? []) {
    fallbacks[_id] = count;
  }
  const round = (value) => (typeof value === 'number' ? Math.round(value) : null);
  return {
    total: totals?.total ?? 0,
    aiAssisted: totals?.aiAssisted ?? 0,
    zeroResults: totals?.zeroResults ?? 0,
    fallbacks,
    latencyMs: {
      avg: round(totals?.avg),
      p50: round(totals?.percentiles?.[0]),
      p95: round(totals?.percentiles?.[1]),
      max: round(totals?.max),
    },
  };
}
