// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-206 story)
// AI-Assisted Areas: integration tests for SCRUM-206 — no query text or reversible hash stored (AT-2), no user id (AT-3), GET /api/search-telemetry permission and tenant scoping (AT-4), TTL retention (AT-5)
// Human Contributions: pending review
// Notes: Written for SCRUM-206. Must be reviewed and tested by the owning team member before merge.

/**
 * Integration tests for search telemetry (SCRUM-206), end to end through the real app.
 *
 * Foundry is mocked so the AI-on path can be exercised without a live endpoint, as in
 * assetSearch.test.js. The recording itself (one row per search, per fallback) is tested at the
 * service level in tests/unit/services/searchTelemetry.recording.test.js; this file covers what the
 * story says must hold of the stored data and of the admin route.
 */
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ai/foundry.client.js', () => ({
  isFoundryEnabled: vi.fn(() => false),
  foundryRequest: vi.fn(),
  promptFingerprint: vi.fn(() => 'fingerprint'),
}));

const { default: app } = await import('../../../src/app.js');
const foundry = await import('../../../src/services/ai/foundry.client.js');
const searchLogRepo = await import('../../../src/repositories/searchQueryLog.repository.js');
const { SEARCH_LOG_RETENTION_DAYS } = await import('../../../src/utils/constants.js');
const { accessCookieFor } = await import('../../helpers/authAs.js');
const { seedTwoOrgs } = await import('../../helpers/seedTwoOrgs.js');

const recordedResponse = JSON.parse(
  readFileSync(
    new URL('../../fixtures/foundry/asset-search-response.json', import.meta.url),
    'utf8',
  ),
);

/** The recorded Foundry envelope with the model's answer replaced by `answer`. */
function foundryReply(answer) {
  const reply = structuredClone(recordedResponse);
  const message = reply.output.find((item) => item.type === 'message');
  message.content[0].text = JSON.stringify(answer);
  return reply;
}

const PATH = '/api/search-telemetry';
const collection = () => mongoose.connection.db.collection('searchquerylogs');

let seed;
beforeEach(async () => {
  vi.clearAllMocks();
  foundry.isFoundryEnabled.mockReturnValue(false);
  seed = await seedTwoOrgs();
});

/** GET `path` as `user`. */
function getAs(user, path) {
  return request(app).get(path).set('Cookie', accessCookieFor(user));
}

/** Wait until the collection holds `n` rows; the writes are fire-and-forget. */
async function waitForRows(n) {
  await vi.waitFor(async () => expect(await collection().countDocuments()).toBe(n), {
    timeout: 5_000,
    interval: 20,
  });
}

/** One raw row for `orgId`, written straight to the collection so its timestamp can be chosen. */
function rawRow(orgId, overrides = {}) {
  return {
    orgId: new mongoose.Types.ObjectId(String(orgId)),
    timestamp: new Date(),
    kind: 'search',
    assetId: null,
    aiAssisted: false,
    fallbackReason: 'disabled',
    latencyMs: 100,
    candidateCount: 0,
    resultCount: 1,
    ...overrides,
  };
}

describe('SCRUM-206 AT-2: no query text, and no way to reconstruct it', () => {
  // Distinctive enough that a match anywhere in a row cannot be a coincidence.
  const QUERY = 'Canon R6 Mark II';

  /** Every form a careless implementation might have stored the query in. */
  const forbiddenForms = () => {
    const forms = [QUERY, QUERY.toLowerCase(), QUERY.toLowerCase().replace(/\s+/g, '')];
    for (const text of [QUERY, QUERY.toLowerCase(), QUERY.trim()]) {
      for (const algorithm of ['sha256', 'sha1', 'md5']) {
        const hex = createHash(algorithm).update(text).digest('hex');
        forms.push(hex, hex.slice(0, 16), createHash(algorithm).update(text).digest('base64'));
      }
      forms.push(Buffer.from(text).toString('base64'));
    }
    // An HMAC with a key an attacker could guess is no better than a plain hash.
    forms.push(createHmac('sha256', '').update(QUERY).digest('hex'));
    return forms.map((form) => form.toLowerCase());
  };

  /** Every stored row, serialised: values, keys, everything. */
  async function everything() {
    const rows = await collection().find({}).toArray();
    return JSON.stringify(rows).toLowerCase();
  }

  it('no row holds the query, a plain hash of it, or an encoding of it — AI off, AI on, and fallbacks', async () => {
    const camera = seed.a.extraAssets[0].asset;

    // AI off.
    await getAs(seed.a.member, `/api/assets/search?q=${encodeURIComponent(QUERY)}`);
    // AI on, answering.
    foundry.isFoundryEnabled.mockReturnValue(true);
    foundry.foundryRequest.mockResolvedValueOnce(
      foundryReply({
        matches: [{ assetId: String(camera._id), reason: 'A camera.' }],
        clarification: null,
      }),
    );
    await getAs(seed.a.member, `/api/assets/search?q=${encodeURIComponent(QUERY)}`);
    // AI on, broken output.
    foundry.foundryRequest.mockResolvedValueOnce(foundryReply({ nope: true }));
    await getAs(seed.a.member, `/api/assets/search?q=${encodeURIComponent(QUERY)}`);

    await waitForRows(3);
    const stored = await everything();
    for (const form of forbiddenForms()) {
      expect(stored).not.toContain(form);
    }
  });

  it('the model has no field that could hold text, and refuses one that is added', async () => {
    const { SearchQueryLog } = await import('../../../src/models/SearchQueryLog.js');
    const stringPaths = Object.entries(SearchQueryLog.schema.paths)
      .filter(([, type]) => type.instance === 'String')
      .map(([path]) => path);
    // The only strings are the two enums; neither can hold free text.
    expect(stringPaths.sort()).toEqual(['fallbackReason', 'kind']);
    expect(SearchQueryLog.schema.path('kind').enumValues.length).toBeGreaterThan(0);

    await expect(SearchQueryLog.create({ ...rawRow(seed.a.orgId), query: QUERY })).rejects.toThrow(
      /query/,
    );
  });
});

describe('SCRUM-206 AT-3: no per-member search history', () => {
  it('a row carries no user id, however the search was made', async () => {
    await getAs(seed.a.member, '/api/assets/search?q=camera');
    await getAs(seed.a.member, `/api/assets/${seed.a.asset._id}/alternatives`);

    await waitForRows(2);
    const rows = await collection().find({}).toArray();
    const memberId = String(seed.a.member._id);
    for (const row of rows) {
      expect(Object.keys(row)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/user|actor|member|requester/i)]),
      );
      expect(JSON.stringify(row)).not.toContain(memberId);
    }
  });
});

describe('SCRUM-206 AT-4: GET /api/search-telemetry', () => {
  it('rejects a caller with no session', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });

  it('is admin-only (audit:read): members and approvers get 403', async () => {
    for (const role of ['member', 'approver']) {
      const res = await getAs(seed.a[role], PATH);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it("summarises the caller's organisation, and never counts another's", async () => {
    await collection().insertMany([
      rawRow(seed.a.orgId, { aiAssisted: true, fallbackReason: null, latencyMs: 200 }),
      rawRow(seed.a.orgId, { fallbackReason: 'unavailable', latencyMs: 400 }),
      rawRow(seed.a.orgId, { fallbackReason: 'contract', resultCount: 0, latencyMs: 600 }),
      rawRow(seed.a.orgId, { kind: 'alternatives', fallbackReason: 'disabled', latencyMs: 800 }),
      // Org B's rows: if any of these were counted, every number below would be wrong.
      ...Array.from({ length: 5 }, () => rawRow(seed.b.orgId, { resultCount: 0 })),
    ]);

    const res = await getAs(seed.a.admin, PATH);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: null,
      total: 4,
      aiAssisted: 1,
      fallbacks: { disabled: 1, unavailable: 1, contract: 1 },
      fallbackRate: 0.75,
      zeroResults: 1,
      zeroResultRate: 0.25,
      latencyMs: { avg: 500, max: 800 },
    });
    expect(res.body.latencyMs.p50).toEqual(expect.any(Number));
    expect(res.body.latencyMs.p95).toEqual(expect.any(Number));
  });

  it('returns aggregates only, never individual rows', async () => {
    await collection().insertOne(rawRow(seed.a.orgId));

    const res = await getAs(seed.a.admin, PATH);

    expect(Object.keys(res.body).sort()).toEqual(
      [
        'aiAssisted',
        'fallbackRate',
        'fallbacks',
        'from',
        'kind',
        'latencyMs',
        'to',
        'total',
        'zeroResultRate',
        'zeroResults',
      ].sort(),
    );
  });

  it('ignores an orgId smuggled in the query string (SR-2)', async () => {
    await collection().insertMany([rawRow(seed.b.orgId), rawRow(seed.b.orgId)]);

    const res = await getAs(seed.a.admin, `${PATH}?orgId=${seed.b.orgId}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('filters by date range and by kind', async () => {
    await collection().insertMany([
      rawRow(seed.a.orgId, { timestamp: new Date('2026-10-01T12:00:00Z') }),
      rawRow(seed.a.orgId, { timestamp: new Date('2026-10-03T12:00:00Z') }),
      rawRow(seed.a.orgId, { timestamp: new Date('2026-10-03T13:00:00Z'), kind: 'alternatives' }),
    ]);
    const range = 'from=2026-10-02T00:00:00Z&to=2026-10-04T00:00:00Z';

    const both = await getAs(seed.a.admin, `${PATH}?${range}`);
    const searchOnly = await getAs(seed.a.admin, `${PATH}?${range}&kind=search`);

    expect(both.body.total).toBe(2);
    expect(searchOnly.body).toMatchObject({ total: 1, kind: 'search' });
  });

  it('reports no data as null rates rather than 0%', async () => {
    const res = await getAs(seed.a.admin, PATH);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 0,
      fallbackRate: null,
      zeroResultRate: null,
      fallbacks: { disabled: 0, unavailable: 0, contract: 0 },
      latencyMs: { avg: null, p50: null, p95: null, max: null },
    });
  });

  it('rejects a range that ends before it starts, and an unknown kind', async () => {
    const backwards = await getAs(
      seed.a.admin,
      `${PATH}?from=2026-10-05T00:00:00Z&to=2026-10-01T00:00:00Z`,
    );
    const unknown = await getAs(seed.a.admin, `${PATH}?kind=everything`);

    expect(backwards.status).toBe(400);
    expect(unknown.status).toBe(400);
  });
});

describe('SCRUM-206 AT-5: retention is enforced, not aspirational', () => {
  it('the TTL index exists and matches SEARCH_LOG_RETENTION_DAYS', async () => {
    const indexes = await collection().indexes();
    const ttl = indexes.find((index) => index.name === 'timestamp_ttl');

    expect(ttl).toBeDefined();
    expect(ttl.key).toEqual({ timestamp: 1 });
    expect(ttl.expireAfterSeconds).toBe(SEARCH_LOG_RETENTION_DAYS * 24 * 60 * 60);
  });

  // Slow on purpose: MongoDB's TTL monitor sweeps about once every 60 seconds, so this waits for a
  // real sweep. Speeding the monitor up (`ttlMonitorSleepSecs`) is a server-wide setting, and other
  // test files share the server — refresh-token rows would start expiring under their feet.
  it(
    'MongoDB deletes a row past the window and keeps one inside it',
    { timeout: 90_000 },
    async () => {
      const day = 24 * 60 * 60 * 1000;
      await collection().insertMany([
        rawRow(seed.a.orgId, {
          timestamp: new Date(Date.now() - (SEARCH_LOG_RETENTION_DAYS + 1) * day),
          latencyMs: 1,
        }),
        rawRow(seed.a.orgId, {
          timestamp: new Date(Date.now() - (SEARCH_LOG_RETENTION_DAYS - 1) * day),
          latencyMs: 2,
        }),
      ]);

      await vi.waitFor(
        async () => expect(await collection().countDocuments({ latencyMs: 1 })).toBe(0),
        { timeout: 80_000, interval: 500 },
      );
      expect(await collection().countDocuments({ latencyMs: 2 })).toBe(1);
    },
  );

  it('a row cannot be backdated by its writer to dodge the window', async () => {
    const tenYearsAgo = new Date('2016-01-01T00:00:00Z');
    const row = await searchLogRepo.append(seed.a.orgId, {
      kind: 'search',
      aiAssisted: false,
      fallbackReason: 'disabled',
      latencyMs: 1,
      candidateCount: 0,
      resultCount: 0,
      timestamp: tenYearsAgo,
    });

    expect(row.timestamp.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
