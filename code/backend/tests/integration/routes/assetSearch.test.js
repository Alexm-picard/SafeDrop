// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (inferred: 2 of 2 commits co-authored by Claude Code)
// AI-Assisted Areas: GET /api/assets/search route, and plain-search fallback on a Foundry outage (SCRUM-200)
// Human Contributions: reviewed and approved by Alex Picard (PR #56, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: header added for SCRUM-216; the file had none.

/**
 * Integration tests for `GET /api/assets/search` (SCRUM-200).
 *
 * The service behind it is tested in tests/unit/services/assetSearch.test.js; these pin down what the
 * route adds: who may call it, what `q` may hold, that the tenant comes from the token alone, and that
 * a Foundry outage reaches the member as plain results rather than an error (SCRUM-103 AT2).
 *
 * `foundry.client.js` is mocked so a test can switch AI on without a live endpoint. The fixture
 * (`seedTwoOrgs`) gives each organisation a Laptop, a Camera and a Projector, suffixed with its key.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableError } from '../../../src/utils/errors.js';

vi.mock('../../../src/services/ai/foundry.client.js', () => ({
  isFoundryEnabled: vi.fn(() => false),
  foundryRequest: vi.fn(),
  promptFingerprint: vi.fn(() => 'fingerprint'),
}));

const { default: app } = await import('../../../src/app.js');
const foundry = await import('../../../src/services/ai/foundry.client.js');
const assetRepo = await import('../../../src/repositories/asset.repository.js');
const { accessCookieFor } = await import('../../helpers/authAs.js');
const { seedTwoOrgs } = await import('../../helpers/seedTwoOrgs.js');

let seed;
let cameraA;
beforeEach(async () => {
  vi.clearAllMocks();
  foundry.isFoundryEnabled.mockReturnValue(false);
  seed = await seedTwoOrgs();
  cameraA = seed.a.extraAssets[0].asset;
});

/** GET the search route as `user` with the given query string. */
function search(user, query) {
  return request(app).get(`/api/assets/search${query}`).set('Cookie', accessCookieFor(user));
}

describe('GET /api/assets/search (SCRUM-200)', () => {
  it('rejects a caller with no session', async () => {
    const res = await request(app).get('/api/assets/search?q=camera');
    expect(res.status).toBe(401);
  });

  it('every role can search (assets:read is universal)', async () => {
    for (const role of ['member', 'approver', 'admin']) {
      const res = await search(seed.a[role], '?q=camera');
      expect(res.status).toBe(200);
    }
  });

  it("returns the caller org's matches in the service's shape, and never another org's", async () => {
    // Both orgs hold a Camera; only org A's may come back to an org A member (SR-2).
    const res = await search(seed.a.member, '?q=camera');

    expect(res.body).toEqual({
      matches: [expect.objectContaining({ assetId: String(cameraA._id), name: 'Camera A' })],
      clarification: null,
      aiAssisted: false,
    });
  });

  it('ignores an orgId smuggled in the query string rather than trusting it', async () => {
    // scopeTenant erases tenant keys before validation, so this is not a 400: the request runs, as
    // org A, exactly as if the key had never been sent (SR-2).
    const res = await search(seed.a.member, `?q=camera&orgId=${seed.b.orgId}`);

    expect(res.status).toBe(200);
    expect(res.body.matches.map((m) => m.name)).toEqual(['Camera A']);
  });

  it('leaves retired assets out (SCRUM-145, end to end)', async () => {
    await assetRepo.retire(seed.a.orgId, cameraA._id);

    const res = await search(seed.a.member, '?q=camera');

    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([]);
  });

  // Before the route existed these passed for the wrong reason: `/search` fell through to `GET /:id`,
  // and "search" is not an ObjectId. The 200-length case below is what proves `q` is the gate now.
  it.each([
    ['missing', ''],
    ['empty', '?q='],
    ['only whitespace', '?q=%20%20%20'],
    ['longer than 200 characters', `?q=${'a'.repeat(201)}`],
  ])('answers 400 when q is %s', async (_label, query) => {
    const res = await search(seed.a.member, query);
    expect(res.status).toBe(400);
  });

  it('accepts a q of exactly 200 characters', async () => {
    const res = await search(seed.a.member, `?q=${'a'.repeat(200)}`);
    expect(res.status).toBe(200);
  });

  it('falls back to plain results, not an error, when Foundry is unavailable (SCRUM-103 AT2)', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    foundry.foundryRequest.mockRejectedValue(
      new ServiceUnavailableError('The AI service is unavailable'),
    );

    const res = await search(seed.a.member, '?q=camera');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ aiAssisted: false, clarification: null });
    expect(res.body.matches.map((m) => m.name)).toEqual(['Camera A']);
  });
});
