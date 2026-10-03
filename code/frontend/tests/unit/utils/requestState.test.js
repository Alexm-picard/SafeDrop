// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: unit tests for the frontend state-machine mirror and the action rules it drives; SCRUM-205 custody-confirmation actions
// Human Contributions: pending team review
// Notes: Written for SCRUM-123. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for the frontend copy of the checkout state machine (SCRUM-123).
 *
 * This table is a duplicate of the backend's, kept so the SPA can decide which buttons to draw
 * without a round trip. Duplication is only safe if it is pinned, so these tests state the whole
 * table: a change here that the backend did not make will show up as a diff a reviewer can see,
 * rather than as a button that 409s in someone's face.
 *
 * `actionsFor` is the part the screen actually uses, and the interesting cases are the refusals —
 * a member offered an approver's action, an approver offered a cancel that is not theirs, anything
 * at all offered on a terminal state.
 */
import { describe, expect, it } from 'vitest';
import { ROLES } from '../../../src/utils/constants';
import { actionsFor, canTransition, TRANSITIONS } from '../../../src/utils/requestState';

const REQUESTER = 'member-1';
const member = { role: ROLES.MEMBER, userId: REQUESTER };
const approver = { role: ROLES.APPROVER, userId: 'approver-1' };
const admin = { role: ROLES.ORG_ADMIN, userId: 'admin-1' };
const requestIn = (state, requesterId = REQUESTER) => ({ state, requesterId });
const keys = (request, viewer) => actionsFor(request, viewer).map((action) => action.key);

describe('the state machine mirror', () => {
  it('matches the backend table, state for state', () => {
    // Mirrors checkout.service.js TRANSITIONS. Update both together.
    expect(TRANSITIONS).toEqual({
      PENDING: ['APPROVED', 'DENIED', 'CANCELLED'],
      APPROVED: ['CANCELLED', 'CHECKED_OUT', 'EXPIRED'],
      CHECKED_OUT: ['RETURN_PENDING', 'RETURNED', 'OVERDUE', 'LOST'],
      OVERDUE: ['RETURN_PENDING', 'RETURNED', 'LOST'],
      RETURN_PENDING: ['RETURNED', 'CHECKED_OUT'],
      DENIED: [],
      CANCELLED: [],
      RETURNED: [],
      LOST: [],
      EXPIRED: [],
    });
  });

  it('permits only the moves in the table', () => {
    expect(canTransition('PENDING', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'CHECKED_OUT')).toBe(true);
    expect(canTransition('PENDING', 'CHECKED_OUT')).toBe(false);
    expect(canTransition('RETURNED', 'CHECKED_OUT')).toBe(false);
  });

  it('answers false for prototype keys rather than finding something inherited', () => {
    expect(canTransition('__proto__', 'hasOwnProperty')).toBe(false);
    expect(canTransition('constructor', 'APPROVED')).toBe(false);
    expect(canTransition('PENDING', 'constructor')).toBe(false);
  });
});

describe('actionsFor', () => {
  it('offers the requester cancel while cancelling is still legal', () => {
    expect(keys(requestIn('PENDING'), member)).toEqual(['cancel']);
    expect(keys(requestIn('APPROVED'), member)).toContain('cancel');
    // Once it is out, cancelling is no longer a move the machine allows.
    expect(keys(requestIn('CHECKED_OUT'), member)).not.toContain('cancel');
  });

  it('offers deciding and handoff to an approver, by state', () => {
    expect(keys(requestIn('PENDING'), approver)).toEqual(['approve', 'deny']);
    expect(keys(requestIn('APPROVED'), approver)).toEqual(['checkout']);
    expect(keys(requestIn('CHECKED_OUT'), approver)).toEqual(['return']);
    expect(keys(requestIn('OVERDUE'), approver)).toEqual(['return']);
    expect(keys(requestIn('RETURN_PENDING'), approver)).toEqual(['return', 'rejectReturn']);
  });

  it('gives an admin the same actions as an approver', () => {
    expect(keys(requestIn('PENDING'), admin)).toEqual(keys(requestIn('PENDING'), approver));
  });

  it('never offers a member an approver’s action, even on their own request', () => {
    const offered = keys(requestIn('PENDING'), member);
    expect(offered).not.toContain('approve');
    expect(offered).not.toContain('deny');
    expect(keys(requestIn('CHECKED_OUT'), member)).not.toContain('return');
  });

  it('offers an approver cancel only on a request that is theirs', () => {
    expect(keys(requestIn('PENDING', approver.userId), approver)).toContain('cancel');
    expect(keys(requestIn('PENDING'), approver)).not.toContain('cancel');
  });

  it('offers nothing in a terminal state, for anyone', () => {
    for (const state of ['DENIED', 'CANCELLED', 'RETURNED', 'LOST', 'EXPIRED']) {
      expect(keys(requestIn(state), member)).toEqual([]);
      expect(keys(requestIn(state), admin)).toEqual([]);
    }
  });

  it('offers nothing when the request or viewer is missing', () => {
    expect(actionsFor(undefined, member)).toEqual([]);
    expect(actionsFor(requestIn('PENDING'), undefined)).toEqual([]);
    expect(actionsFor({ state: 'NOT_A_STATE', requesterId: REQUESTER }, member)).toEqual([]);
  });
});

describe('actionsFor: custody confirmation (SCRUM-205)', () => {
  const labels = (request, viewer) =>
    Object.fromEntries(actionsFor(request, viewer).map((action) => [action.key, action.label]));

  it('lets the borrower record their own pickup, in their own words (AT-1)', () => {
    expect(keys(requestIn('APPROVED'), member)).toEqual(['cancel', 'checkout']);
    expect(labels(requestIn('APPROVED'), member).checkout).toBe('I’ve picked it up');
    expect(labels(requestIn('APPROVED'), approver).checkout).toBe('Record handoff');
  });

  it('never offers another member the pickup (AT-2)', () => {
    const someoneElse = { role: ROLES.MEMBER, userId: 'member-2' };
    expect(keys(requestIn('APPROVED'), someoneElse)).toEqual([]);
  });

  it('offers the borrower "Return this item" while it is out, whatever their role (AT-4)', () => {
    expect(keys(requestIn('CHECKED_OUT'), member)).toEqual(['initiateReturn']);
    expect(keys(requestIn('OVERDUE'), member)).toEqual(['initiateReturn']);
    expect(keys(requestIn('CHECKED_OUT', approver.userId), approver)).toEqual(['initiateReturn']);
    expect(labels(requestIn('CHECKED_OUT'), member).initiateReturn).toBe('Return this item');
  });

  it('offers a different confirmer Confirm and Reject on a pending return (AT-5, AT-6)', () => {
    expect(keys(requestIn('RETURN_PENDING'), admin)).toEqual(['return', 'rejectReturn']);
    expect(labels(requestIn('RETURN_PENDING'), admin).return).toBe('Confirm return');
    expect(labels(requestIn('CHECKED_OUT'), admin).return).toBe('Record return');
  });

  it('never offers the pickup again once a return is pending, even though both lead to CHECKED_OUT', () => {
    expect(keys(requestIn('RETURN_PENDING'), admin)).not.toContain('checkout');
  });

  it('hides Confirm and Reject from a member and from the requester (AT-7)', () => {
    expect(keys(requestIn('RETURN_PENDING'), member)).toEqual([]);
    expect(keys(requestIn('RETURN_PENDING', approver.userId), approver)).toEqual([]);
    expect(keys(requestIn('CHECKED_OUT', approver.userId), approver)).not.toContain('return');
  });

  it('follows the API when it says the sole admin may confirm their own return (AT-8)', () => {
    const own = requestIn('RETURN_PENDING', admin.userId);
    expect(keys(own, admin)).toEqual([]);
    expect(keys(own, { ...admin, canConfirmReturn: true })).toEqual(['return', 'rejectReturn']);
  });

  it('follows the API when it says a confirmer may not', () => {
    expect(keys(requestIn('RETURN_PENDING'), { ...admin, canConfirmReturn: false })).toEqual([]);
  });
});
