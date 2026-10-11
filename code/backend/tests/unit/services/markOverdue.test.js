// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code for the mark-overdue story, Lab 3)
// AI-Assisted Areas: the service contract of markOverdue — `now` is passed in, the tenant is
//   required, and the count comes back from the repository unchanged
// Human Contributions: story owned, prompted and committed by Orelmis Toribio; reviewed and approved by Alex Picard (PR #50, 2026-09-29); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL

/**
 * Unit tests for `checkout.service.markOverdue` (mark-overdue story).
 *
 * The repository is mocked so these tests can see exactly what the service hands it — which `now`,
 * which tenant — and prove what it refuses to do. That the database then moves the right documents
 * is the integration suite's job (tests/integration/routes/overdue.test.js).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/repositories/checkoutRequest.repository.js', () => ({
  markOverdue: vi.fn(),
}));

const checkoutRepo = await import('../../../src/repositories/checkoutRequest.repository.js');
const { markOverdue } = await import('../../../src/services/checkout.service.js');

const ORG = '6aab2a45c6e457e01ac0968a';
const NOW = new Date('2026-09-25T00:00:00Z');

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('markOverdue: service contract', () => {
  it('hands the repository exactly the tenant and the instant it was given', async () => {
    checkoutRepo.markOverdue.mockResolvedValue(1);
    await markOverdue(ORG, { now: NOW });
    expect(checkoutRepo.markOverdue).toHaveBeenCalledTimes(1);
    expect(checkoutRepo.markOverdue).toHaveBeenCalledWith(ORG, NOW);
  });

  it('returns how many requests the repository moved', async () => {
    checkoutRepo.markOverdue.mockResolvedValue(3);
    await expect(markOverdue(ORG, { now: NOW })).resolves.toBe(3);
  });

  it('returns 0 when nothing was late', async () => {
    checkoutRepo.markOverdue.mockResolvedValue(0);
    await expect(markOverdue(ORG, { now: NOW })).resolves.toBe(0);
  });

  it('never reads the clock itself: the instant passed in is the one used', async () => {
    // A system clock months away from `now` must make no difference to what is sent.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2030-01-01T00:00:00Z') });
    checkoutRepo.markOverdue.mockResolvedValue(0);
    await markOverdue(ORG, { now: NOW });
    expect(checkoutRepo.markOverdue.mock.calls[0][1].toISOString()).toBe(
      '2026-09-25T00:00:00.000Z',
    );
  });

  it.each([
    ['missing', undefined],
    ['not a Date', '2026-09-25'],
    ['an invalid Date', new Date('not a date')],
  ])('refuses a `now` that is %s, without touching the database', async (_label, now) => {
    await expect(markOverdue(ORG, { now })).rejects.toThrow(TypeError);
    expect(checkoutRepo.markOverdue).not.toHaveBeenCalled();
  });

  it('refuses to run with no options at all', async () => {
    await expect(markOverdue(ORG)).rejects.toThrow(TypeError);
    expect(checkoutRepo.markOverdue).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
  ])(
    'refuses an orgId that is %s, so a missing tenant can never widen the update (SR-2)',
    async (_label, orgId) => {
      // Mongoose drops an undefined filter key, so `{ orgId: undefined }` would match every tenant.
      await expect(markOverdue(orgId, { now: NOW })).rejects.toThrow(TypeError);
      expect(checkoutRepo.markOverdue).not.toHaveBeenCalled();
    },
  );
});
