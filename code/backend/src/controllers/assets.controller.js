// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: asset catalogue handlers (Sprint 1 stubs → 501)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * HTTP layer for `/api/assets`.
 *
 * Each handler does the same three things: pass `req.orgId` (set from the verified token by
 * scopeTenant, never from the URL), pass `req.auth` as the actor when the action is auditable, and
 * choose the status code — 201 for something created, 200 otherwise. All the behaviour lives in
 * asset.service.js.
 *
 * `req.id` travels with every write so the resulting audit event can be traced back to the request
 * that caused it. The reads take no actor and no `req.id`: looking at the catalogue is not an
 * auditable event.
 */
import * as assetService from '../services/asset.service.js';

/**
 * `GET /api/assets` — list the catalogue. Query filters are already validated and coerced.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function list(req, res) {
  res.status(200).json(await assetService.list(req.orgId, req.query));
}

/**
 * `GET /api/assets/:id` — read one asset with its units.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function get(req, res) {
  res.status(200).json(await assetService.get(req.orgId, req.params.id));
}

/**
 * `POST /api/assets` — create an asset. Answers 201.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function create(req, res) {
  res
    .status(201)
    .json(await assetService.create(req.orgId, req.auth, { ...req.body, requestId: req.id }));
}

/**
 * `PATCH /api/assets/:id` — apply a partial update.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function update(req, res) {
  res.status(200).json(
    await assetService.update(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

/**
 * `POST /api/assets/:id/retire` — soft-delete an asset.
 *
 * A POST to a sub-path rather than a DELETE, because the asset is not removed: it stays, dated, so
 * history still resolves.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function retire(req, res) {
  res
    .status(200)
    .json(await assetService.retire(req.orgId, req.auth, req.params.id, { requestId: req.id }));
}

/**
 * `POST /api/assets/:id/units` — add a physical unit to an asset. Answers 201.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function addUnit(req, res) {
  res.status(201).json(
    await assetService.addUnit(req.orgId, req.auth, req.params.id, {
      ...req.body,
      requestId: req.id,
    }),
  );
}

/**
 * `GET /api/assets/:id/history` — one asset's complete chain of custody (SCRUM-29).
 *
 * A read, so no actor and no `req.id`: nothing is recorded about reading the record. Who may call it
 * is settled by the route's `audit:read` permission, which only an ORG_ADMIN holds.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function history(req, res) {
  res.status(200).json(await assetService.history(req.orgId, req.params.id, req.query));
}
