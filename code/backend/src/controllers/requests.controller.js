// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: checkout request handlers (Sprint 1 stubs → 501)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import * as checkoutService from '../services/checkout.service.js';

export async function list(req, res) {
  res.status(200).json(await checkoutService.list(req.orgId, req.auth, req.query));
}

export async function get(req, res) {
  res.status(200).json(await checkoutService.get(req.orgId, req.auth, req.params.id));
}

export async function create(req, res) {
  res
    .status(201)
    .json(await checkoutService.submit(req.orgId, req.auth, { ...req.body, requestId: req.id }));
}

export async function approve(req, res) {
  res.status(200).json(
    await checkoutService.approve(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

export async function deny(req, res) {
  res.status(200).json(
    await checkoutService.deny(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

export async function cancel(req, res) {
  res
    .status(200)
    .json(await checkoutService.cancel(req.orgId, req.auth, req.params.id, { requestId: req.id }));
}

export async function checkout(req, res) {
  res
    .status(200)
    .json(
      await checkoutService.checkout(req.orgId, req.auth, req.params.id, { requestId: req.id }),
    );
}

export async function returnUnit(req, res) {
  res.status(200).json(
    await checkoutService.returnUnit(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}
