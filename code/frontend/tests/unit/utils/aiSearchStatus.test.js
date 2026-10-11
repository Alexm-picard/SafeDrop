// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: tests for the AI search status line and its attention thresholds (SCRUM-242)
// Human Contributions: feature choice and placement by Amber Rastella; reviewer recorded on the PR
// Notes: The thresholds are imported, so these tests follow them if the team retunes them.

/**
 * Tests for `aiSearchStatus`, the one line both the AI search page and the Overview's alert show
 * (SCRUM-242). The cases that matter are the edges: exactly at the thresholds, and the fallbacks that
 * are not failures.
 */
import { describe, expect, it } from 'vitest';
import { FAILING_RATE, MIN_SEARCHES, aiSearchStatus } from '../../../src/utils/aiSearchStatus';

/** A summary of `total` searches, all ranked by AI unless `fallbacks` says otherwise. */
function summary({ total = 40, disabled = 0, unavailable = 0, contract = 0, capHits = 0 } = {}) {
  return {
    total,
    aiAssisted: total - disabled - unavailable - contract,
    fallbacks: { disabled, unavailable, contract },
    candidateCapHits: capHits,
    candidateCap: 100,
  };
}

describe('aiSearchStatus', () => {
  it('reports a healthy month as working normally, with no alert', () => {
    expect(aiSearchStatus(summary({ unavailable: 1 }))).toMatchObject({
      kind: 'ok',
      tone: 'ok',
      title: 'AI search is working normally',
      detail: '39 of 40 searches in the last 30 days were ranked by AI.',
      needsAttention: false,
    });
  });

  it('says so when nobody has searched', () => {
    expect(aiSearchStatus(summary({ total: 0 }))).toMatchObject({
      kind: 'none',
      needsAttention: false,
    });
  });

  it('treats AI switched off for the deployment as a fact, not an alarm', () => {
    // An organisation's admin cannot turn it on, so nagging them on the Overview would not help.
    expect(aiSearchStatus(summary({ total: 12, disabled: 12 }))).toMatchObject({
      kind: 'off',
      tone: 'muted',
      needsAttention: false,
    });
  });

  it('needs attention once failures reach the rate, at the minimum number of searches', () => {
    const failing = Math.ceil(MIN_SEARCHES * FAILING_RATE);
    expect(aiSearchStatus(summary({ total: MIN_SEARCHES, unavailable: failing }))).toMatchObject({
      kind: 'failing',
      tone: 'warn',
      needsAttention: true,
    });
  });

  it('counts an unusable answer as a failure, the same as no answer', () => {
    expect(aiSearchStatus(summary({ total: 10, unavailable: 1, contract: 1 })).kind).toBe(
      'failing',
    );
  });

  it('does not alarm on a couple of unlucky searches below the minimum', () => {
    expect(
      aiSearchStatus(summary({ total: MIN_SEARCHES - 1, unavailable: MIN_SEARCHES - 1 })).kind,
    ).not.toBe('failing');
  });

  it('does not count switched-off searches towards the failure rate', () => {
    expect(aiSearchStatus(summary({ total: 10, disabled: 5 })).kind).toBe('ok');
  });

  it('needs attention when any search reached the candidate limit', () => {
    expect(aiSearchStatus(summary({ capHits: 1 }))).toMatchObject({
      kind: 'catalog',
      detail:
        'AI search considers up to 100 items per search, so some items were left out of one search.',
      needsAttention: true,
    });
  });

  it('reports failures first when both apply', () => {
    expect(aiSearchStatus(summary({ total: 10, unavailable: 5, capHits: 3 })).kind).toBe('failing');
  });
});
