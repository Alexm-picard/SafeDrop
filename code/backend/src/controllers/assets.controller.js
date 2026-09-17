// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: asset catalogue handlers (Sprint 1 stubs → 501)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import * as assetService from '../services/asset.service.js';

export async function list(req, res) {
  res.status(200).json(await assetService.list(req.orgId, req.query));
}

export async function get(req, res) {
  res.status(200).json(await assetService.get(req.orgId, req.params.id));
}

export async function create(req, res) {
  res
    .status(201)
    .json(await assetService.create(req.orgId, req.auth, { ...req.body, requestId: req.id }));
}

export async function update(req, res) {
  res.status(200).json(
    await assetService.update(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

export async function retire(req, res) {
  res
    .status(200)
    .json(await assetService.retire(req.orgId, req.auth, req.params.id, { requestId: req.id }));
}

export async function addUnit(req, res) {
  res.status(201).json(
    await assetService.addUnit(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}
