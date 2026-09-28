// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~85% (test-first pairing session; each test written before its production code)
// AI-Assisted Areas: integration tests for unit maintenance (SCRUM-141) — authorisation, state transitions, tenant isolation, audit
// Human Contributions: acceptance criteria, test ordering and the red/green decisions by Mateus Silva
// Notes: Written for Lab 3 (TDD). Every test here was committed red before the code that makes it pass.

/**
 * Integration tests for taking one physical unit out of circulation and putting it back
 * (`POST /api/assets/:id/units/:unitId/maintenance` and `.../maintenance/end`, SCRUM-141).
 *
 * Maintenance is the reversible counterpart to retiring: a broken unit stops being lendable while it
 * is repaired, then comes back. Retiring is permanent, so it is the wrong tool for a repair.
 *
 * The fixture (`seedTwoOrgs`) has a unit ready for every criterion — the laptop's units are
 * REQUESTED, OUT and HELD (all of which must refuse maintenance), and the camera's are AVAILABLE,
 * AVAILABLE and RETIRED.
 *
 * One `it()` per acceptance criterion, so the trail from user story to AC to test is readable
 * top to bottom.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

/** The camera and its first unit, which the seed leaves AVAILABLE — the one legal starting state. */
const availableUnit = (org) => ({
  asset: org.extraAssets[0].asset,
  unit: org.extraAssets[0].units[0],
});

/**
 * A seeded unit already in `status`, with the asset that owns it.
 *
 * The fixture happens to contain one of every status we need to refuse, so AC3 needs no setup of its
 * own: the laptop's three units are REQUESTED, OUT and HELD, and the camera's third is RETIRED.
 * @param {object} org one side of `seedTwoOrgs()`
 * @param {string} status
 * @returns {{ asset: object, unit: object }}
 */
const unitInStatus = (org, status) =>
  ({
    REQUESTED: { asset: org.asset, unit: org.units[0] },
    OUT: { asset: org.asset, unit: org.units[1] },
    HELD: { asset: org.asset, unit: org.units[2] },
    RETIRED: { asset: org.extraAssets[0].asset, unit: org.extraAssets[0].units[2] },
  })[status];

describe('POST /api/assets/:id/units/:unitId/maintenance (SCRUM-141)', () => {
  it('AC5: refuses a MEMBER with 403 — taking stock out of circulation is an admin action', async () => {
    const { asset, unit } = availableUnit(seed.a);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('AC1: moves an AVAILABLE unit to MAINTENANCE and returns the updated unit', async () => {
    const { asset, unit } = availableUnit(seed.a);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: String(unit._id), status: 'MAINTENANCE' });

    // And it stuck: the response is not just an optimistic echo of what was asked for.
    const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(stored.status).toBe('MAINTENANCE');
  });

  /**
   * AC3. Each of these is refused for its own reason — someone is holding it (OUT), it is promised
   * to someone (HELD), someone is waiting on a decision (REQUESTED), or it has permanently left the
   * inventory (RETIRED) — but the answer is the same 409 in every case. Only an AVAILABLE unit can
   * be sent for repair.
   */
  it.each(['OUT', 'HELD', 'REQUESTED', 'RETIRED'])(
    'AC3: refuses a %s unit with 409 and leaves its status alone',
    async (status) => {
      const { asset, unit } = unitInStatus(seed.a, status);

      const res = await request(app)
        .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
        .set('Cookie', accessCookieFor(seed.a.admin))
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');

      // A refusal has to be inert: the unit is exactly as it was.
      const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
      expect(stored.status).toBe(status);
    },
  );

  it('AC5: answers 404, never 403, for another organisation’s unit (SR-2)', async () => {
    const { asset, unit } = availableUnit(seed.b);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // Nothing moved on the other side of the boundary.
    const untouched = await assetUnitRepo.findById(seed.b.orgId, unit._id);
    expect(untouched.status).toBe('AVAILABLE');
  });

  it('AC5: answers 404 for a unit that belongs to a different asset in the same org', async () => {
    // The camera's AVAILABLE unit, addressed through the laptop. The unit is real, it is in the
    // caller's own organisation, and it is in a state that would otherwise succeed — so only the
    // asset/unit relationship can refuse it.
    const { unit } = availableUnit(seed.a);
    const wrongAsset = seed.a.asset;

    const res = await request(app)
      .post(`/api/assets/${wrongAsset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const untouched = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(untouched.status).toBe('AVAILABLE');
  });

  it('AC5: answers 404 for a unit id that does not exist', async () => {
    const res = await request(app)
      .post(`/api/assets/${seed.a.asset._id}/units/${'0'.repeat(24)}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/assets/:id/units/:unitId/maintenance/end (SCRUM-141)', () => {
  /**
   * Send a unit for repair through the API, so the two endpoints are exercised as the pair an admin
   * actually uses rather than by reaching past the service to set the status directly.
   * @param {object} org one side of `seedTwoOrgs()`
   * @returns {Promise<{ asset: object, unit: object }>}
   */
  async function sendForRepair(org) {
    const { asset, unit } = availableUnit(org);
    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(org.admin))
      .send({});
    expect(res.status).toBe(200);
    return { asset, unit };
  }

  it('AC2: brings a repaired unit back from MAINTENANCE to AVAILABLE', async () => {
    const { asset, unit } = await sendForRepair(seed.a);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance/end`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: String(unit._id), status: 'AVAILABLE' });

    const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(stored.status).toBe('AVAILABLE');
  });

  it('AC2: ending maintenance on an already AVAILABLE unit answers 200, not an error', async () => {
    // A double-click, or a second admin who did not see the first one finish. The unit is available,
    // which is what the caller wanted — so this is a no-op, not a failure. The audit trail records
    // state *changes*, not requests, so the second call must not append a second row; that half is
    // pinned by the audit tests once UNIT_MAINTENANCE_ENDED exists (AC6).
    const { asset, unit } = await sendForRepair(seed.a);
    const path = `/api/assets/${asset._id}/units/${unit._id}/maintenance/end`;

    const first = await request(app)
      .post(path)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(path)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: String(unit._id), status: 'AVAILABLE' });
  });

  it('AC2: refuses with 409 to bring a RETIRED unit back into circulation', async () => {
    // Retiring is permanent. Ending maintenance must not become a back door to un-retiring a unit
    // that was written off — and RETIRED never went into maintenance in the first place.
    const { asset, unit } = unitInStatus(seed.a, 'RETIRED');

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance/end`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(stored.status).toBe('RETIRED');
  });
});
