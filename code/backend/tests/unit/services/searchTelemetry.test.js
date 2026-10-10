// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-206 story)
// AI-Assisted Areas: recordSearch never throws or blocks (AT-6); summarize window defaults and rates (AT-4)
// Human Contributions: pending review
// Notes: Written for SCRUM-206. Must be reviewed and tested by the owning team member before merge.

/**
 * Unit tests for services/ai/searchTelemetry.service.js (SCRUM-206), with the repository mocked.
 *
 * The rows and the aggregation are tested against a real database in
 * searchTelemetry.recording.test.js and tests/integration/routes/searchTelemetry.test.js; this file
 * pins down the service's own decisions — that a write can never surface to the caller, and how the
 * summary turns counts into rates.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/repositories/searchQueryLog.repository.js', () => ({
  append: vi.fn(),
  summarize: vi.fn(),
}));

const repo = await import('../../../src/repositories/searchQueryLog.repository.js');
const { recordSearch, summarize } =
  await import('../../../src/services/ai/searchTelemetry.service.js');

const ORG = '6aab2a45c6e457e01ac0968a';
const ROW = {
  kind: 'search',
  aiAssisted: false,
  fallbackReason: 'disabled',
  latencyMs: 12,
  candidateCount: 0,
  resultCount: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordSearch (AT-6)', () => {
  it('passes the org and the row to the repository', () => {
    repo.append.mockResolvedValue({});
    recordSearch(ORG, ROW);
    expect(repo.append).toHaveBeenCalledWith(ORG, ROW);
  });

  it('returns nothing to await, so it cannot be put in the request path by accident', () => {
    repo.append.mockResolvedValue({});
    expect(recordSearch(ORG, ROW)).toBeUndefined();
  });

  it('swallows a rejected write', async () => {
    repo.append.mockRejectedValue(new Error('down'));
    expect(() => recordSearch(ORG, ROW)).not.toThrow();
    // Let the rejection settle; an unhandled one would fail the run.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('swallows a synchronous throw', () => {
    repo.append.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => recordSearch(ORG, ROW)).not.toThrow();
  });
});

describe('summarize (AT-4)', () => {
  const stats = (overrides = {}) => ({
    total: 10,
    aiAssisted: 6,
    zeroResults: 2,
    fallbacks: { disabled: 1, unavailable: 2, contract: 1 },
    latencyMs: { avg: 400, p50: 350, p95: 900, max: 1200 },
    ...overrides,
  });

  it('defaults to the 30 days before now', async () => {
    repo.summarize.mockResolvedValue(stats());
    const now = new Date('2026-10-10T12:00:00Z');

    const result = await summarize(ORG, {}, { now });

    expect(repo.summarize).toHaveBeenCalledWith(ORG, {
      from: new Date('2026-09-10T12:00:00Z'),
      to: now,
      kind: undefined,
    });
    expect(result.from).toBe('2026-09-10T12:00:00.000Z');
    expect(result.to).toBe('2026-10-10T12:00:00.000Z');
  });

  it('passes an explicit range and kind through unchanged', async () => {
    repo.summarize.mockResolvedValue(stats());
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-10-05T00:00:00Z');

    await summarize(ORG, { from, to, kind: 'alternatives' });

    expect(repo.summarize).toHaveBeenCalledWith(ORG, { from, to, kind: 'alternatives' });
  });

  it('turns counts into rates', async () => {
    repo.summarize.mockResolvedValue(stats());

    const result = await summarize(ORG, {});

    expect(result).toMatchObject({
      total: 10,
      aiAssisted: 6,
      fallbacks: { disabled: 1, unavailable: 2, contract: 1 },
      fallbackRate: 0.4,
      zeroResults: 2,
      zeroResultRate: 0.2,
      latencyMs: { avg: 400, p50: 350, p95: 900, max: 1200 },
      kind: null,
    });
  });

  it('reports rates as null, not 0, when there were no searches', async () => {
    repo.summarize.mockResolvedValue(
      stats({
        total: 0,
        aiAssisted: 0,
        zeroResults: 0,
        fallbacks: { disabled: 0, unavailable: 0, contract: 0 },
        latencyMs: { avg: null, p50: null, p95: null, max: null },
      }),
    );

    const result = await summarize(ORG, {});

    expect(result.fallbackRate).toBeNull();
    expect(result.zeroResultRate).toBeNull();
  });
});
