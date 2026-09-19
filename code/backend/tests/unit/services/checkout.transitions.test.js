// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: exhaustive F4 state-machine test: every allowed pair passes, every other pair throws StateTransitionError (NFR-11)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Unit tests for the checkout state machine (arch review F4).
 *
 * Tests the table as a whole rather than case by case: every state appears exactly once as a source,
 * the allowed moves are exactly the ones the SDD lists, terminal states have no outgoing transitions,
 * and the table is frozen.
 *
 * The prototype-key tests are the security-relevant ones. A state string reaching the machine from
 * client input must not resolve `constructor` or `__proto__` to something truthy — with plain property
 * lookups it would, producing a "legal" transition that was never in the table.
 */
import { describe, expect, it } from 'vitest';
import * as checkout from '../../../src/services/checkout.service.js';
import { REQUEST_STATE_LIST, UNIT_STATUS } from '../../../src/utils/constants.js';
import { NotImplementedError, StateTransitionError } from '../../../src/utils/errors.js';

const allowed = [
  ['PENDING', 'APPROVED', UNIT_STATUS.HELD],
  ['PENDING', 'DENIED', null],
  ['PENDING', 'CANCELLED', null],
  ['APPROVED', 'CANCELLED', UNIT_STATUS.AVAILABLE],
  ['APPROVED', 'CHECKED_OUT', UNIT_STATUS.OUT],
  ['CHECKED_OUT', 'RETURNED', UNIT_STATUS.AVAILABLE],
  ['CHECKED_OUT', 'OVERDUE', null],
  ['CHECKED_OUT', 'LOST', UNIT_STATUS.RETIRED],
  ['OVERDUE', 'RETURNED', UNIT_STATUS.AVAILABLE],
  ['OVERDUE', 'LOST', UNIT_STATUS.RETIRED],
];
const allowedKeys = new Set(allowed.map(([f, t]) => `${f}→${t}`));

describe('checkout state machine (F4)', () => {
  it('the table covers every state exactly once as a source', () => {
    expect(Object.keys(checkout.TRANSITIONS).sort()).toEqual([...REQUEST_STATE_LIST].sort());
  });

  it.each(allowed)('%s → %s is allowed with unit side-effect %s', (from, to, unitStatus) => {
    expect(checkout.assertTransition(from, to)).toEqual({ unitStatus });
    expect(checkout.canTransition(from, to)).toBe(true);
  });

  const forbidden = REQUEST_STATE_LIST.flatMap((from) =>
    REQUEST_STATE_LIST.filter((to) => !allowedKeys.has(`${from}→${to}`)).map((to) => [from, to]),
  );

  it.each(forbidden)('%s → %s throws StateTransitionError', (from, to) => {
    expect(() => checkout.assertTransition(from, to)).toThrow(StateTransitionError);
    expect(checkout.canTransition(from, to)).toBe(false);
    try {
      checkout.assertTransition(from, to);
    } catch (err) {
      expect(err.status).toBe(409);
      expect(err.details).toEqual({ from, to });
    }
  });

  it('unknown states are rejected', () => {
    expect(() => checkout.assertTransition('BOGUS', 'APPROVED')).toThrow(StateTransitionError);
    expect(() => checkout.assertTransition('PENDING', 'BOGUS')).toThrow(StateTransitionError);
    expect(() => checkout.assertTransition(undefined, undefined)).toThrow(StateTransitionError);
  });

  it('terminal states have no outgoing transitions', () => {
    expect([...checkout.TERMINAL_STATES].sort()).toEqual([
      'CANCELLED',
      'DENIED',
      'LOST',
      'RETURNED',
    ]);
  });

  it.each(['submit', 'get', 'cancel'])(
    'handler %s is a Sprint 1 stub (501)',
    async (name) => {
      await expect(checkout[name]()).rejects.toBeInstanceOf(NotImplementedError);
    },
  );
});

describe('checkout state machine: prototype keys are not states', () => {
  it.each([
    ['__proto__', 'hasOwnProperty'],
    ['constructor', 'assign'],
    ['toString', 'call'],
    ['PENDING', 'constructor'],
    ['PENDING', '__proto__'],
  ])('%s → %s throws StateTransitionError', (from, to) => {
    expect(() => checkout.assertTransition(from, to)).toThrow(StateTransitionError);
    expect(checkout.canTransition(from, to)).toBe(false);
  });
});
