// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Strategy-pattern approval policy; Iteration 1 ships one fixed policy (SDD §8.5)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
 * Iteration 1 policy: every request needs approval by an APPROVER or ORG_ADMIN who is not the
 * requester. Configurable per-asset / per-group policies are Iteration 2 (desirable features).
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

/** Resolve the policy for an organisation. Iteration 1: always the fixed policy. */
export function policyFor(_org) {
  return requireDistinctApprover;
}

/** Registration point for future policies (Iteration 2). */
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

export function getPolicy(name) {
  return policies.get(name) ?? null;
}
