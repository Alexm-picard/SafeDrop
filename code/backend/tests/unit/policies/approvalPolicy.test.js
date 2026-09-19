// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Iteration 1 approval policy tests (SDD §8.5)
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
  getPolicy,
  policyFor,
  registerPolicy,
  requireDistinctApprover,
} from '../../../src/services/policies/approvalPolicy.js';

const request = { requesterId: 'user-1' };

describe('requireDistinctApprover (Iteration 1 policy)', () => {
  it('is the policy for every organisation in Iteration 1 and every request needs approval', () => {
    expect(policyFor({ id: 'any' })).toBe(requireDistinctApprover);
    expect(requireDistinctApprover.requiresApproval(request)).toBe(true);
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
