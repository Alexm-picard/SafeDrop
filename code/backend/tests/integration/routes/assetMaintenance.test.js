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
});
