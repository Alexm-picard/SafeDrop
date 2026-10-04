// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~85% (test-first pairing session; written and run red before the route existed)
// AI-Assisted Areas: integration tests for GET /api/assets/:id/alternatives (SCRUM-151, SCRUM-185)
// Human Contributions: acceptance criteria and the red/green decisions by Mateus Silva
// Notes: The service's own behaviour is covered in tests/unit/services/assetAlternatives.test.js.

/**
 * Integration tests for `GET /api/assets/:id/alternatives` (SCRUM-151, subtask SCRUM-185).
 *
 * The recommendation logic is tested at the service level; these pin down what the *route* adds: who
 * may call it, that the tenant comes from the token alone, and that an id from another organisation is
 * indistinguishable from one that never existed.
 *
 * The fixture is doing real work here. `seedTwoOrgs` leaves org A's laptop with its three units
 * REQUESTED, OUT and HELD — a genuine dead end, with no setup needed — while the camera and projector
 * both have an AVAILABLE unit to recommend.
 *
 * Foundry is mocked and off by default, so these tests exercise the route against the fallback path
 * and need no live endpoint.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ai/foundry.client.js', () => ({
  isFoundryEnabled: vi.fn(() => false),
  foundryRequest: vi.fn(),
  promptFingerprint: vi.fn(() => 'fingerprint'),
}));

const { default: app } = await import('../../../src/app.js');
const foundry = await import('../../../src/services/ai/foundry.client.js');
const { accessCookieFor } = await import('../../helpers/authAs.js');
const { seedTwoOrgs } = await import('../../helpers/seedTwoOrgs.js');

let seed;
/** Org A's laptop: every unit REQUESTED, OUT or HELD, which is the dead end this feature answers. */
let stuckOn;
beforeEach(async () => {
  vi.clearAllMocks();
  foundry.isFoundryEnabled.mockReturnValue(false);
  seed = await seedTwoOrgs();
  stuckOn = seed.a.asset;
});

/** GET the alternatives route for `assetId` as `user`. */
function alternatives(user, assetId) {
  return request(app)
    .get(`/api/assets/${assetId}/alternatives`)
    .set('Cookie', accessCookieFor(user));
}

describe('GET /api/assets/:id/alternatives (SCRUM-151)', () => {
  it('offers a member something they can borrow instead', async () => {
    const res = await alternatives(seed.a.member, stuckOn._id);

    expect(res.status).toBe(200);
    expect(res.body.aiAssisted).toBe(false);
    // The camera and the projector each have an AVAILABLE unit; the laptop itself must not appear.
    const ids = res.body.alternatives.map((a) => a.assetId);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain(String(stuckOn._id));
    expect(ids).toContain(String(seed.a.extraAssets[0].asset._id));
  });

  it('answers 404, never 403, for another organisation’s asset id (SR-2)', async () => {
    const res = await alternatives(seed.a.member, seed.b.asset._id);

    // A 403 would confirm the id exists somewhere. So would a 200 carrying an empty list, since the
    // caller could then tell a real id in another tenant from one that never existed by… nothing —
    // which is the point: both must answer identically, and the story says that answer is 404.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.alternatives).toBeUndefined();
  });

  it('answers 404 for an id that does not exist', async () => {
    const res = await alternatives(seed.a.member, '0'.repeat(24));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed id with 400 before it reaches the service', async () => {
    const res = await alternatives(seed.a.member, 'not-an-id');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a caller with no session', async () => {
    const res = await request(app).get(`/api/assets/${stuckOn._id}/alternatives`);

    expect(res.status).toBe(401);
  });

  it('every role may ask (assets:read is universal)', async () => {
    for (const role of ['member', 'approver', 'admin']) {
      const res = await alternatives(seed.a[role], stuckOn._id);
      expect(res.status).toBe(200);
    }
  });

  it('answers 200 with an empty list, not an error, when the asset is available (AT-4)', async () => {
    // The camera has AVAILABLE units, so there is no dead end and nothing to recommend. The page
    // asks the same question either way and must not have to treat "nothing to suggest" as a failure.
    const res = await alternatives(seed.a.member, seed.a.extraAssets[0].asset._id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alternatives: [], aiAssisted: false });
  });
});
