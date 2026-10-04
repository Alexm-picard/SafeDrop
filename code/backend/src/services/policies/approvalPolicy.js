// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Strategy-pattern approval policy; Iteration 1 ships one fixed policy (SDD §8.5); SCRUM-148 configurableApproval (asset → org → REQUIRED); SCRUM-205 canConfirmReturn with the sole-confirmer fallback
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
 * Iteration 2 (SCRUM-148) adds `configurableApproval`, which lets an Org Admin decide whether a
 * request needs a human at all — per organisation, overridable per asset — and makes it the policy
 * every organisation gets.
 *
 * SCRUM-205 adds the same separation of duties to the other end of a loan: `canConfirmReturn` decides
 * who may close a return, so nobody clears themselves of an item that never reached anyone.
 *
 * Exports: `requireDistinctApprover`, `configurableApproval`, `canConfirmReturn`,
 * `effectiveApprovalMode(asset, org)`, `policyFor(org)`, `registerPolicy(policy)`, `getPolicy(name)`.
 */
import { APPROVAL_MODE, ORG_APPROVAL_MODE_LIST } from '../../utils/constants.js';
import { PERMISSIONS, roleHasPermission } from '../../utils/permissions.js';

/**
 * @typedef {object} ApprovalPolicy
 * @property {string} name
 * @property {(request: { requesterId: unknown }, actor: { userId: unknown, role: string }) => { allowed: boolean, reason?: string }} canDecide
 *   May `actor` approve or deny `request`?
 * @property {(context: ApprovalContext) => boolean} requiresApproval
 *   Does this request need a human decision before checkout?
 * @property {(request: { requesterId: unknown }, actor: { userId: unknown, role: string }, org: object, context: { otherConfirmers: number }) => { allowed: boolean, selfConfirmed?: boolean, reason?: string }} [canConfirmReturn]
 *   May `actor` confirm or reject the return of `request`? (SCRUM-205)
 */

/**
 * What a policy is shown when asked whether a request needs approval (SCRUM-148).
 *
 * The request alone is not enough once the rule is configurable: the asset carries the per-asset
 * override and the organisation carries the default, so both travel with it.
 * @typedef {object} ApprovalContext
 * @property {object} request the request being submitted
 * @property {{ approvalMode?: string }} [asset] the asset the requested unit belongs to
 * @property {{ approvalSettings?: { defaultMode?: string } }} [org] the requester's organisation
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
  // A hoisted function declaration (below), so it is already defined here.
  canConfirmReturn,
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

/**
 * May `actor` confirm (or reject) the return of `request`? (SCRUM-205)
 *
 * The return-side twin of `canDecide`. The actor needs `requests:handoff`, and must not be the
 * requester: otherwise an approver could mark their own loan returned while the item sits in their
 * bag, and the record would say it is back.
 *
 * **The sole-confirmer fallback.** In an organisation where the requester is the only Approver or Org
 * Admin, nobody else could ever close their loan. There the requester is allowed, and the answer
 * carries `selfConfirmed: true` so the audit entry can say so. `otherConfirmers` is how many *other*
 * active Approvers and Org Admins exist; the service counts it, because a policy must not read the
 * database. `org` is part of the signature so a later per-organisation rule has it to hand.
 * @param {{ requesterId: unknown }} request
 * @param {{ userId: unknown, role: string }} actor
 * @param {object} _org
 * @param {{ otherConfirmers: number }} context
 * @returns {{ allowed: boolean, selfConfirmed?: boolean, reason?: string }}
 */
export function canConfirmReturn(request, actor, _org, { otherConfirmers } = {}) {
  if (!actor || !roleHasPermission(actor.role, PERMISSIONS.REQUESTS_HANDOFF)) {
    return { allowed: false, reason: 'role cannot confirm returns' };
  }
  if (String(request.requesterId) !== String(actor.userId)) {
    return { allowed: true, selfConfirmed: false };
  }
  // Fail closed: an unknown count is treated as "someone else exists".
  if (otherConfirmers === 0) {
    return { allowed: true, selfConfirmed: true };
  }
  return { allowed: false, reason: 'requester cannot confirm their own return' };
}

/**
 * Configurable approval (SCRUM-148): the policy every organisation gets from Iteration 2.
 *
 * The rule: an asset's `approvalMode` wins unless it is INHERIT, in which case the organisation's
 * `approvalSettings.defaultMode` decides. Anything missing or unrecognised answers REQUIRED, so a
 * document written before the migration (or a corrupt value) fails closed rather than skipping
 * approval — an unknown mode quietly auto-approving would hand every member a free pass.
 *
 * Who may decide is unchanged from `requireDistinctApprover`: configurability changes *whether* a
 * human decides, never *who*.
 * @type {ApprovalPolicy}
 */
export const configurableApproval = Object.freeze({
  name: 'configurable-approval',
  requiresApproval({ asset, org } = {}) {
    return effectiveApprovalMode(asset, org) !== APPROVAL_MODE.AUTO;
  },
  canDecide: requireDistinctApprover.canDecide,
  canConfirmReturn,
});

/**
 * Resolve the mode that applies to one asset: its own override, else the organisation default, else
 * REQUIRED.
 *
 * Membership is checked against the frozen lists with `includes`, not by indexing into an object, so
 * a value such as `constructor` or `__proto__` cannot resolve to something truthy.
 * @param {{ approvalMode?: string }} [asset]
 * @param {{ approvalSettings?: { defaultMode?: string } }} [org]
 * @returns {'REQUIRED'|'AUTO'}
 */
export function effectiveApprovalMode(asset, org) {
  const assetMode = asset?.approvalMode;
  if (assetMode !== APPROVAL_MODE.INHERIT && ORG_APPROVAL_MODE_LIST.includes(assetMode)) {
    return assetMode;
  }
  if (assetMode !== undefined && assetMode !== null && assetMode !== APPROVAL_MODE.INHERIT) {
    // Present but not a mode we know: fail closed rather than falling through to the org default.
    return APPROVAL_MODE.REQUIRED;
  }
  const orgMode = org?.approvalSettings?.defaultMode;
  return ORG_APPROVAL_MODE_LIST.includes(orgMode) ? orgMode : APPROVAL_MODE.REQUIRED;
}

const policies = new Map([
  [requireDistinctApprover.name, requireDistinctApprover],
  [configurableApproval.name, configurableApproval],
]);

/**
 * Resolve the approval policy for an organisation.
 *
 * Every organisation gets `configurableApproval` (SCRUM-148). Its settings travel in the `org` and
 * `asset` passed to `requiresApproval`, not in the choice of policy, so one policy object serves every
 * tenant. With the migration's defaults (REQUIRED / INHERIT) it behaves exactly like the Iteration 1
 * policy.
 * @param {object} _org
 * @returns {ApprovalPolicy}
 */
export function policyFor(_org) {
  return configurableApproval;
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
