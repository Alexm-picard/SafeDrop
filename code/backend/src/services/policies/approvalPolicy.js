// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Strategy-pattern approval policy; Iteration 1 ships one fixed policy (SDD §8.5)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Who may approve a checkout request, expressed as a swappable policy.
 *
 * The rule is behind an interface rather than inlined into the checkout service because it is the
 * part most likely to differ per organisation — some will want approvals per asset category, per team,
 * or none at all for cheap items (Iteration 2). The checkout service asks `policyFor(org)` and applies
 * whatever comes back, so a new rule is a new object here rather than a change to the workflow.
 *
 * Iteration 1 ships one policy: every request needs a decision by someone with `requests:decide` who
 * is not the requester.
 *
 * Exports: `requireDistinctApprover`, `policyFor(org)`, `registerPolicy(policy)`, `getPolicy(name)`.
 */
import { PERMISSIONS, roleHasPermission } from '../../utils/permissions.js';

/**
 * @typedef {object} ApprovalPolicy
 * @property {string} name
 * @property {(request: { requesterId: unknown }, actor: { userId: unknown, role: string }) => { allowed: boolean, reason?: string }} canDecide
 *   May `actor` approve or deny `request`?
 * @property {(request: object) => boolean} requiresApproval
 *   Does this request need a human decision before checkout?
 */

/**
 * The Iteration 1 policy: every request needs approval, and nobody approves their own.
 *
 * `canDecide` checks two things in order — the actor's role must hold `requests:decide`, and the
 * actor must not be the requester. The second is separation of duties: an approver filing their own
 * request could otherwise grant it themselves, which is exactly what an approval step is meant to
 * prevent. Ids are compared as strings because one side is a Mongoose ObjectId and the other comes
 * from a token.
 *
 * The returned `reason` is for logs and tests; callers translate a refusal into a 403.
 * @type {ApprovalPolicy}
 */
export const requireDistinctApprover = Object.freeze({
  name: 'require-distinct-approver',
  requiresApproval: () => true,
  canDecide(request, actor) {
    if (!actor || !roleHasPermission(actor.role, PERMISSIONS.REQUESTS_DECIDE)) {
      return { allowed: false, reason: 'role cannot decide requests' };
    }
    if (String(request.requesterId) === String(actor.userId)) {
      return { allowed: false, reason: 'requester cannot decide their own request' };
    }
    return { allowed: true };
  },
});

const policies = new Map([[requireDistinctApprover.name, requireDistinctApprover]]);

/**
 * Resolve the approval policy for an organisation.
 *
 * Iteration 1 always answers `requireDistinctApprover`; the parameter is already in the signature so
 * that per-organisation policies can arrive without touching the callers.
 * @param {object} _org
 * @returns {ApprovalPolicy}
 */
export function policyFor(_org) {
  return requireDistinctApprover;
}

/**
 * Register an additional policy under its name (Iteration 2 extension point).
 *
 * The shape is validated on the way in — a policy missing `canDecide` would otherwise fail much
 * later, in the middle of an approval, where the failure is expensive and confusing.
 * @param {ApprovalPolicy} policy
 * @throws {TypeError} when the policy lacks a name, `canDecide()` or `requiresApproval()`
 */
export function registerPolicy(policy) {
  if (
    !policy?.name ||
    typeof policy.canDecide !== 'function' ||
    typeof policy.requiresApproval !== 'function'
  ) {
    throw new TypeError('An approval policy needs name, canDecide() and requiresApproval()');
  }
  policies.set(policy.name, policy);
}

/**
 * Look up a registered policy by name.
 * @param {string} name
 * @returns {ApprovalPolicy|null} null when no policy is registered under that name
 */
export function getPolicy(name) {
  return policies.get(name) ?? null;
}
