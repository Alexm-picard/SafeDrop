// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Iteration 1 approval policy tests (SDD §8.5); SCRUM-205 canConfirmReturn and the sole-confirmer fallback
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Unit tests for the Iteration 1 approval policy.
 *
 * The central rule is separation of duties: a requester cannot decide their own request, *even as
 * ORG_ADMIN*. A role that lacks `requests:decide` cannot decide at all, and unknown roles or a missing
 * actor are denied rather than defaulted.
 *
 * One test compares an ObjectId against a string id, because that is what actually happens in
 * production — the request carries a Mongoose id and the actor's comes from a token — and a strict
 * comparison there would silently let a requester approve their own request.
 */
import { describe, expect, it } from 'vitest';
import {
  canConfirmReturn,
  configurableApproval,
  getPolicy,
  policyFor,
  registerPolicy,
  requireDistinctApprover,
} from '../../../src/services/policies/approvalPolicy.js';

const request = { requesterId: 'user-1' };

describe('requireDistinctApprover (Iteration 1 policy)', () => {
  // SCRUM-148 replaced this policy as the one `policyFor` answers (see the block below); the policy
  // itself is unchanged and still requires approval for everything.
  it('requires approval for every request', () => {
    expect(requireDistinctApprover.requiresApproval({ request })).toBe(true);
  });

  it('the requester cannot approve their own request, even as ORG_ADMIN', () => {
    expect(
      requireDistinctApprover.canDecide(request, { userId: 'user-1', role: 'ORG_ADMIN' }),
    ).toMatchObject({ allowed: false });
    expect(
      requireDistinctApprover.canDecide(request, { userId: 'user-1', role: 'APPROVER' }),
    ).toMatchObject({ allowed: false });
  });

  it('a MEMBER cannot approve', () => {
    expect(
      requireDistinctApprover.canDecide(request, { userId: 'user-2', role: 'MEMBER' }),
    ).toMatchObject({ allowed: false });
  });

  it.each(['APPROVER', 'ORG_ADMIN'])('a distinct %s can approve', (role) => {
    expect(requireDistinctApprover.canDecide(request, { userId: 'user-2', role })).toEqual({
      allowed: true,
    });
  });

  it('compares ids by value (ObjectId vs string)', () => {
    const id = { toString: () => 'user-1' };
    expect(
      requireDistinctApprover.canDecide({ requesterId: id }, { userId: 'user-1', role: 'APPROVER' })
        .allowed,
    ).toBe(false);
  });

  it('denies unknown roles and missing actors', () => {
    expect(requireDistinctApprover.canDecide(request, { userId: 'u', role: 'ROOT' }).allowed).toBe(
      false,
    );
    expect(requireDistinctApprover.canDecide(request, undefined).allowed).toBe(false);
  });

  it('registers additional strategies for later iterations', () => {
    const custom = {
      name: 'auto-approve-members',
      requiresApproval: () => false,
      canDecide: () => ({ allowed: true }),
    };
    registerPolicy(custom);
    expect(getPolicy('auto-approve-members')).toBe(custom);
    expect(getPolicy('nope')).toBeNull();
    expect(() => registerPolicy({ name: 'broken' })).toThrow(TypeError);
  });
});

/**
 * SCRUM-148: configurable approval.
 *
 * Resolution order is asset override → organisation default → REQUIRED. The last step is the safety
 * net: a document from before the migration, or a value nobody recognises, must fail closed — an
 * unknown mode skipping approval would be a silent privilege escalation for every member.
 */
describe('configurableApproval (SCRUM-148)', () => {
  const org = (defaultMode) => ({ approvalSettings: { defaultMode } });
  const asset = (approvalMode) => ({ approvalMode });
  const needsApproval = (context) => configurableApproval.requiresApproval({ request, ...context });

  it('is the policy every organisation gets, and is registered by name', () => {
    expect(policyFor(org('REQUIRED'))).toBe(configurableApproval);
    expect(policyFor(org('AUTO'))).toBe(configurableApproval);
    expect(getPolicy('configurable-approval')).toBe(configurableApproval);
  });

  // The whole rule as a table: [org default, asset mode, needs approval?]. AT-1 and AT-2 are the two
  // override rows; the INHERIT rows are what every asset does after the migration.
  it.each([
    ['REQUIRED', 'INHERIT', true],
    ['AUTO', 'INHERIT', false],
    ['REQUIRED', 'AUTO', false], // AT-1: cheap item skips the queue
    ['AUTO', 'REQUIRED', true], // AT-2: expensive item still gets a human
    ['REQUIRED', 'REQUIRED', true],
    ['AUTO', 'AUTO', false],
  ])('org default %s, asset %s → requires approval: %s', (defaultMode, approvalMode, expected) => {
    expect(needsApproval({ org: org(defaultMode), asset: asset(approvalMode) })).toBe(expected);
  });

  it('fails closed: missing settings, a missing asset mode or an unknown value require approval', () => {
    expect(needsApproval({ org: {}, asset: {} })).toBe(true);
    expect(needsApproval({})).toBe(true);
    expect(needsApproval({ org: org('AUTO'), asset: asset('SOMETIMES') })).toBe(true);
    expect(needsApproval({ org: org('SOMETIMES'), asset: asset('INHERIT') })).toBe(true);
    // INHERIT is an asset value; an organisation "inheriting" has nowhere to inherit from.
    expect(needsApproval({ org: org('INHERIT'), asset: asset('INHERIT') })).toBe(true);
  });

  it('does not let prototype names stand in for a mode', () => {
    expect(needsApproval({ org: org('AUTO'), asset: asset('constructor') })).toBe(true);
    expect(needsApproval({ org: org('__proto__'), asset: asset('INHERIT') })).toBe(true);
  });

  // AT-2's second half: configurability changes *whether* a human decides, never *who*.
  it('keeps separation of duties: the requester cannot decide, even as ORG_ADMIN', () => {
    expect(
      configurableApproval.canDecide(request, { userId: 'user-1', role: 'ORG_ADMIN' }).allowed,
    ).toBe(false);
    expect(
      configurableApproval.canDecide(request, { userId: 'user-2', role: 'MEMBER' }).allowed,
    ).toBe(false);
    expect(configurableApproval.canDecide(request, { userId: 'user-2', role: 'APPROVER' })).toEqual(
      { allowed: true },
    );
  });
});

describe('canConfirmReturn (SCRUM-205)', () => {
  const org = {};
  const mine = { requesterId: 'user-1' };

  it('lets a different Approver or Org Admin confirm, without the self-confirmed flag', () => {
    for (const role of ['APPROVER', 'ORG_ADMIN']) {
      expect(canConfirmReturn(mine, { userId: 'user-2', role }, org, {})).toEqual({
        allowed: true,
        selfConfirmed: false,
      });
    }
  });

  it('refuses a member, even on their own request and even when nobody else could confirm', () => {
    expect(
      canConfirmReturn(mine, { userId: 'user-1', role: 'MEMBER' }, org, { otherConfirmers: 0 })
        .allowed,
    ).toBe(false);
    expect(canConfirmReturn(mine, { userId: 'user-2', role: 'MEMBER' }, org, {}).allowed).toBe(
      false,
    );
  });

  it('refuses the requester while anyone else could confirm', () => {
    expect(
      canConfirmReturn(mine, { userId: 'user-1', role: 'ORG_ADMIN' }, org, { otherConfirmers: 1 }),
    ).toMatchObject({ allowed: false });
  });

  it('lets the sole confirmer close their own return, flagged as self-confirmed', () => {
    expect(
      canConfirmReturn(mine, { userId: 'user-1', role: 'ORG_ADMIN' }, org, { otherConfirmers: 0 }),
    ).toEqual({ allowed: true, selfConfirmed: true });
  });

  it('fails closed when the count of other confirmers is unknown', () => {
    expect(canConfirmReturn(mine, { userId: 'user-1', role: 'ORG_ADMIN' }, org, {}).allowed).toBe(
      false,
    );
  });

  it('compares an ObjectId requester against a string actor id', () => {
    const withObjectId = { requesterId: { toString: () => 'user-1' } };
    expect(
      canConfirmReturn(withObjectId, { userId: 'user-1', role: 'APPROVER' }, org, {
        otherConfirmers: 2,
      }).allowed,
    ).toBe(false);
  });

  it('is what both shipped policies answer with', () => {
    expect(configurableApproval.canConfirmReturn).toBe(canConfirmReturn);
    expect(requireDistinctApprover.canConfirmReturn).toBe(canConfirmReturn);
  });
});
