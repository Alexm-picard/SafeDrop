// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: SCRUM-102 dashboard cache: one computation per TTL, per tenant, failures not cached
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Unit tests for the dashboard summary's cache (SCRUM-102, task 4).
 *
 * The repositories are mocked, so these tests can count *how many times* the aggregations run —
 * which is the whole point of the cache and the one thing an integration test cannot see. Only
 * `Date` is faked, not timers: the mocked clock is enough to step past the TTL, and faking the
 * timers as well would stall the MongoDB driver that the shared test setup keeps connected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/repositories/assetUnit.repository.js', () => ({
  countByStatus: vi.fn(),
}));
vi.mock('../../../src/repositories/checkoutRequest.repository.js', () => ({
  countByState: vi.fn(),
  countOverdue: vi.fn(),
  countCheckoutsByDay: vi.fn(),
}));

const assetUnitRepo = await import('../../../src/repositories/assetUnit.repository.js');
const checkoutRepo = await import('../../../src/repositories/checkoutRequest.repository.js');
const { summary, clearSummaryCache, SUMMARY_CACHE_TTL_MS, ACTIVITY_WINDOW_DAYS } =
  await import('../../../src/services/dashboard.service.js');

const ORG = '6aab2a45c6e457e01ac0968a';
const OTHER_ORG = '6aab2a45c6e457e01ac0968b';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
  clearSummaryCache();
  assetUnitRepo.countByStatus.mockResolvedValue({
    AVAILABLE: 4,
    HELD: 1,
    OUT: 2,
    RETIRED: 1,
  });
  checkoutRepo.countByState.mockResolvedValue({ PENDING: 3, CHECKED_OUT: 2 });
  checkoutRepo.countOverdue.mockResolvedValue(1);
  checkoutRepo.countCheckoutsByDay.mockResolvedValue({ '2026-09-19': 2 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('dashboard summary shape', () => {
  it('reports the counts the story asks for, with retired units outside the total', async () => {
    expect(await summary(ORG)).toMatchObject({
      totalAssets: 7,
      checkedOut: 2,
      available: 4,
      held: 1,
      retired: 1,
      pendingRequests: 3,
      overdue: 1,
    });
  });

  it('measures lateness against now', async () => {
    await summary(ORG);
    expect(checkoutRepo.countOverdue).toHaveBeenCalledWith(ORG, new Date('2026-09-20T12:00:00Z'));
  });

  it('zero-fills the window and asks the repository for exactly those days', async () => {
    const { activity } = await summary(ORG);
    expect(activity).toHaveLength(ACTIVITY_WINDOW_DAYS);
    expect(activity[0]).toEqual({ date: '2026-08-22', checkouts: 0 });
    expect(activity.at(-1)).toEqual({ date: '2026-09-20', checkouts: 0 });
    expect(activity.find((day) => day.date === '2026-09-19')).toEqual({
      date: '2026-09-19',
      checkouts: 2,
    });
    // Half-open, on UTC day boundaries: the whole of the first day in, the whole of tomorrow out.
    expect(checkoutRepo.countCheckoutsByDay).toHaveBeenCalledWith(ORG, {
      from: new Date('2026-08-22T00:00:00Z'),
      to: new Date('2026-09-21T00:00:00Z'),
    });
  });
});

describe('dashboard summary cache', () => {
  it('computes once for repeated reads inside the TTL', async () => {
    const first = await summary(ORG);
    const second = await summary(ORG);
    expect(second).toBe(first);
    expect(assetUnitRepo.countByStatus).toHaveBeenCalledTimes(1);
  });

  it('shares one computation between concurrent readers', async () => {
    const [first, second] = await Promise.all([summary(ORG), summary(ORG)]);
    expect(second).toBe(first);
    expect(assetUnitRepo.countByStatus).toHaveBeenCalledTimes(1);
  });

  it('recomputes once the TTL has passed', async () => {
    await summary(ORG);
    vi.setSystemTime(Date.now() + SUMMARY_CACHE_TTL_MS + 1);
    await summary(ORG);
    expect(assetUnitRepo.countByStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps one organisation’s numbers out of another’s (SR-2)', async () => {
    await summary(ORG);
    assetUnitRepo.countByStatus.mockResolvedValue({
      AVAILABLE: 0,
      HELD: 0,
      OUT: 0,
      RETIRED: 0,
    });
    expect(await summary(OTHER_ORG)).toMatchObject({ totalAssets: 0 });
    expect(assetUnitRepo.countByStatus).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    checkoutRepo.countOverdue.mockRejectedValueOnce(new Error('database is down'));
    await expect(summary(ORG)).rejects.toThrow('database is down');
    await expect(summary(ORG)).resolves.toMatchObject({ overdue: 1 });
  });

  it('clearSummaryCache forces the next read to recompute', async () => {
    await summary(ORG);
    clearSummaryCache();
    await summary(ORG);
    expect(assetUnitRepo.countByStatus).toHaveBeenCalledTimes(2);
  });
});
