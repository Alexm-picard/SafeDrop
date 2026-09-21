// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: admin dashboard summary aggregated from AssetUnit.status (SCRUM-102); pending/overdue
//   counts, the 30-day activity series and the 60-second cache (SCRUM-102); now includes REQUESTED units
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The admin dashboard summary (SCRUM-102).
 *
 * One read that answers the four questions an org admin opens the dashboard for: how much do we own,
 * how much is out, how much is waiting on a decision, and how much is late. The numbers come from
 * two collections — unit statuses for the inventory counts, checkout requests for the workflow ones —
 * and are assembled here rather than in four separate endpoints, because they are read together and a
 * page that fires four requests can show four inconsistent moments.
 *
 * `checkedOut` counts units and `overdue` counts requests. They agree because one request moves one
 * unit, but they are measured on different collections: `checkedOut` answers "how many items are not
 * on the shelf", `overdue` answers "how many loans are late".
 *
 * Every result is cached for a minute (see `SUMMARY_CACHE_TTL_MS`), so a dashboard left open, or
 * several admins on it at once, does not re-run five aggregations per page load.
 *
 * Exports: `summary`, `clearSummaryCache`, `SUMMARY_CACHE_TTL_MS`, `ACTIVITY_WINDOW_DAYS`.
 */
import * as assetUnitRepo from '../repositories/assetUnit.repository.js';
import * as checkoutRepo from '../repositories/checkoutRequest.repository.js';
import { REQUEST_STATE, UNIT_STATUS } from '../utils/constants.js';

/** How long a computed summary may be served before it is recomputed (SCRUM-102, task 4). */
export const SUMMARY_CACHE_TTL_MS = 60_000;
/** How many days the activity chart covers, today included. */
export const ACTIVITY_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * orgId → `{ expiresAt, result }`, where `result` is the in-flight *promise*.
 *
 * Caching the promise rather than the resolved value is what makes the cache useful under the load it
 * exists for: when several admins hit the dashboard at once, the second and third requests join the
 * first one's aggregations instead of starting their own. Entries are per tenant, so one
 * organisation's traffic can never serve another's numbers.
 */
const cache = new Map();

/**
 * Drop every cached summary.
 *
 * Exists for tests, which need the next call to hit the database after they have changed the data
 * underneath it — within the TTL, that is exactly what the cache is designed not to do.
 * @returns {void}
 */
export function clearSummaryCache() {
  cache.clear();
}

/**
 * Remove expired entries so the map does not grow with every organisation that ever loaded the page.
 * @param {number} now epoch milliseconds
 */
function evictExpired(now) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

/**
 * Midnight UTC on the day `date` falls in.
 *
 * The chart's buckets are UTC days rather than local ones, so the same data produces the same chart
 * whatever timezone the server happens to run in.
 * @param {Date} date
 * @returns {Date}
 */
function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * A Date as the `YYYY-MM-DD` key the day buckets are addressed by.
 * @param {Date} date
 * @returns {string}
 */
const isoDay = (date) => date.toISOString().slice(0, 10);

/**
 * Run the aggregations and shape the response. Called only on a cache miss.
 *
 * The five reads are independent, so they run concurrently: the endpoint costs one round trip's
 * latency rather than five.
 *
 * `totalAssets` deliberately excludes retired units: it answers "how much can this organisation lend
 * out?", and a retired item is gone from that pool even though its row remains for history. A
 * REQUESTED unit, unlike a retired one, is still lendable — it is just spoken for at this moment — so
 * it counts toward `totalAssets` the same way HELD and OUT already do. The retired count is returned
 * separately so the number is visible rather than merely absent, and `requested` is now returned
 * alongside it for the same reason.
 * @param {string} orgId
 * @param {Date} now the instant the summary describes — lateness and the last day of the chart
 * @returns {Promise<object>}
 */
async function computeSummary(orgId, now) {
  const lastDay = startOfUtcDay(now);
  const from = new Date(lastDay.getTime() - (ACTIVITY_WINDOW_DAYS - 1) * DAY_MS);
  const to = new Date(lastDay.getTime() + DAY_MS);
  const [units, states, overdue, checkoutsByDay] = await Promise.all([
    assetUnitRepo.countByStatus(orgId),
    checkoutRepo.countByState(orgId),
    checkoutRepo.countOverdue(orgId, now),
    checkoutRepo.countCheckoutsByDay(orgId, { from, to }),
  ]);
  const available = units[UNIT_STATUS.AVAILABLE];
  const held = units[UNIT_STATUS.HELD];
  const checkedOut = units[UNIT_STATUS.OUT];
  const retired = units[UNIT_STATUS.RETIRED];
  const requested = units[UNIT_STATUS.REQUESTED];
  // Every day in the window, including the ones with no checkouts: a chart with gaps in it would
  // read as "no data" where the truth is "nothing happened".
  const activity = Array.from({ length: ACTIVITY_WINDOW_DAYS }, (_, index) => {
    const date = isoDay(new Date(from.getTime() + index * DAY_MS));
    return { date, checkouts: checkoutsByDay[date] ?? 0 };
  });
  return {
    totalAssets: available + held + checkedOut + requested,
    checkedOut,
    available,
    held,
    retired,
    requested,
    pendingRequests: states[REQUEST_STATE.PENDING],
    overdue,
    activity,
  };
}

/**
 * The organisation's summary for `GET /api/dashboard/summary`, from cache when it is fresh.
 *
 * The staleness this buys is bounded and deliberate: for up to a minute the page can show a count
 * taken a moment ago — including an item that has just tipped over its due date. That is the trade
 * the ticket asks for, and it is safe here because every number is a whole-organisation total that
 * nobody acts on within the same minute; the approval queue and the request detail screen, where
 * acting on a stale row would matter, read the database directly.
 *
 * A failed computation is evicted rather than cached, so an error is not served for the rest of the
 * minute.
 * @param {string} orgId
 * @returns {Promise<{ totalAssets: number, checkedOut: number, available: number, held: number, retired: number, requested: number, pendingRequests: number, overdue: number, activity: Array<{ date: string, checkouts: number }> }>}
 */
export async function summary(orgId) {
  const key = String(orgId);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }
  evictExpired(now);
  const result = computeSummary(orgId, new Date(now));
  const entry = { expiresAt: now + SUMMARY_CACHE_TTL_MS, result };
  cache.set(key, entry);
  try {
    return await result;
  } catch (error) {
    // Only if this call's own entry is still the one cached: a later request may already have
    // replaced it, and evicting that one would throw away a good result.
    if (cache.get(key) === entry) {
      cache.delete(key);
    }
    throw error;
  }
}
