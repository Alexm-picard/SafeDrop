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
});
