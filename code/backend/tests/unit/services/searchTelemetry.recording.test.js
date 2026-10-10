// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-206 story)
// AI-Assisted Areas: one SearchQueryLog row per search and per alternatives lookup, per fallback path (AT-1); telemetry failures never fail a search (AT-6)
// Human Contributions: pending review
// Notes: Written for SCRUM-206. Must be reviewed and tested by the owning team member before merge.

/**
 * What the AI search pipeline records about itself (SCRUM-206 AT-1, AT-6).
 *
 * `foundry.client.js` is mocked, as in assetSearch.test.js, so each of the three fallbacks can be
 * forced. The repositories are real, so the rows asserted on are the rows MongoDB actually holds.
 *
 * The write is fire-and-forget, so a test cannot simply read the collection after `await search()`:
 * the row may still be in flight. `oneRow()` polls for it instead.
 *
 * The telemetry repository's `append` is wrapped in a spy that still calls through, so the AT-6 tests
 * can make it fail without changing anything else.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ai/foundry.client.js', () => ({
  isFoundryEnabled: vi.fn(),
  foundryRequest: vi.fn(),
  promptFingerprint: vi.fn(() => 'fingerprint'),
}));

vi.mock('../../../src/repositories/searchQueryLog.repository.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, append: vi.fn(actual.append) };
});

const { logLines } = vi.hoisted(() => ({ logLines: [] }));
vi.mock('../../../src/utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logger: actual.createLogger({ level: 'debug', write: (line) => logLines.push(line) }),
  };
});

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
  message.content[0].text = typeof answer === 'string' ? answer : JSON.stringify(answer);
  return reply;
}

const foundry = await import('../../../src/services/ai/foundry.client.js');
const assetRepo = await import('../../../src/repositories/asset.repository.js');
const unitRepo = await import('../../../src/repositories/assetUnit.repository.js');
const searchLogRepo = await import('../../../src/repositories/searchQueryLog.repository.js');
const { SearchQueryLog } = await import('../../../src/models/SearchQueryLog.js');
const { searchAssets, getAlternatives } =
  await import('../../../src/services/ai/assetSearch.service.js');
const { ServiceUnavailableError } = await import('../../../src/utils/errors.js');
const { UNIT_STATUS } = await import('../../../src/utils/constants.js');

const ORG = '6aab2a45c6e457e01ac0968a';
const MEMBER = '6aab2a45c6e457e01ac0968c';

/** Exactly the fields a row may have. Anything else — a query, a user — fails the test. */
const ROW_KEYS = [
  '_id',
  'orgId',
  'timestamp',
  'kind',
  'assetId',
  'aiAssisted',
  'fallbackReason',
  'latencyMs',
  'candidateCount',
  'resultCount',
].sort();

beforeEach(() => {
  vi.clearAllMocks();
  logLines.length = 0;
});

/** Wait for the single fire-and-forget row to land, then return it as stored. */
async function oneRow() {
  return vi.waitFor(
    async () => {
      const rows = await SearchQueryLog.find({}).lean();
      expect(rows).toHaveLength(1);
      return rows[0];
    },
    { timeout: 5_000, interval: 20 },
  );
}

/** An asset with one unit per status, as in assetAlternatives.test.js. */
async function assetWithUnits(fields, statuses) {
  const asset = await assetRepo.create(ORG, fields);
  let tag = 0;
  for (const status of statuses) {
    tag += 1;
    await unitRepo.create(ORG, { assetId: asset._id, tag: `${fields.name}-${tag}`, status });
  }
  return asset;
}

describe('SCRUM-206 AT-1: one telemetry row per search', () => {
  it('AI off: records the disabled fallback, no candidates sent, and the result count', async () => {
    foundry.isFoundryEnabled.mockReturnValue(false);
    await assetRepo.create(ORG, { name: 'Epson Projector', category: 'AV' });
    await assetRepo.create(ORG, { name: 'Tripod', category: 'Camera Support' });

    const result = await searchAssets(ORG, 'projector');

    const row = await oneRow();
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(row).toMatchObject({
      kind: 'search',
      assetId: null,
      aiAssisted: false,
      fallbackReason: 'disabled',
      candidateCount: 0,
      resultCount: 1,
    });
    expect(String(row.orgId)).toBe(ORG);
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row.timestamp).toBeInstanceOf(Date);
    expect(result.matches).toHaveLength(1);
  });

  it('AI on and answering: fallbackReason is null and the counts describe what was sent and shown', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    const webcam = await assetRepo.create(ORG, { name: 'Logitech Webcam', category: 'Video' });
    await assetRepo.create(ORG, { name: 'Zoom Recorder', category: 'Audio' });
    foundry.foundryRequest.mockResolvedValue(
      foundryReply({ matches: [{ assetId: webcam.id, reason: 'Video.' }], clarification: null }),
    );

    await searchAssets(ORG, 'record a lecture');

    expect(await oneRow()).toMatchObject({
      aiAssisted: true,
      fallbackReason: null,
      candidateCount: 2,
      resultCount: 1,
    });
  });

  it('Foundry down: records unavailable, with the candidates that were sent', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    await assetRepo.create(ORG, { name: 'Epson Projector', category: 'AV' });
    foundry.foundryRequest.mockRejectedValue(new ServiceUnavailableError('down'));

    await searchAssets(ORG, 'projector');

    expect(await oneRow()).toMatchObject({
      aiAssisted: false,
      fallbackReason: 'unavailable',
      candidateCount: 1,
      resultCount: 1,
    });
  });

  it('model broke the output contract: records contract', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    await assetRepo.create(ORG, { name: 'Epson Projector', category: 'AV' });
    foundry.foundryRequest.mockResolvedValue(foundryReply('Sure! Here are some projectors.'));

    await searchAssets(ORG, 'projector');

    expect(await oneRow()).toMatchObject({ aiAssisted: false, fallbackReason: 'contract' });
  });

  it('a search that finds nothing is recorded with resultCount 0 (the zero-result rate)', async () => {
    foundry.isFoundryEnabled.mockReturnValue(false);

    await searchAssets(ORG, 'hovercraft');

    expect(await oneRow()).toMatchObject({ resultCount: 0 });
  });

  it('a bug in the search records nothing, rather than reporting it as a fallback', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    await assetRepo.create(ORG, { name: 'Epson Projector', category: 'AV' });
    foundry.foundryRequest.mockRejectedValue(new TypeError('a programming error'));

    await expect(searchAssets(ORG, 'projector')).rejects.toThrow(TypeError);
    expect(searchLogRepo.append).not.toHaveBeenCalled();
  });
});

describe('SCRUM-206 AT-1: alternatives (SCRUM-151) are recorded the same way', () => {
  it('records kind alternatives with the asset as its subject', async () => {
    foundry.isFoundryEnabled.mockReturnValue(false);
    const r6 = await assetWithUnits({ name: 'Canon R6', category: 'camera' }, [UNIT_STATUS.OUT]);
    await assetWithUnits({ name: 'Sony A7', category: 'camera' }, [UNIT_STATUS.AVAILABLE]);

    const result = await getAlternatives(ORG, MEMBER, r6.id);

    const row = await oneRow();
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(row).toMatchObject({
      kind: 'alternatives',
      aiAssisted: false,
      fallbackReason: 'disabled',
      resultCount: result.alternatives.length,
    });
    expect(String(row.assetId)).toBe(r6.id);
  });

  it('AI on and answering: fallbackReason is null, and a made-up id is not counted as a result', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    const r6 = await assetWithUnits({ name: 'Canon R6', category: 'camera' }, [UNIT_STATUS.OUT]);
    const a7 = await assetWithUnits({ name: 'Sony A7', category: 'camera' }, [
      UNIT_STATUS.AVAILABLE,
    ]);
    foundry.foundryRequest.mockResolvedValue(
      foundryReply({
        matches: [
          { assetId: a7.id, reason: 'Comparable full-frame body, on the shelf now.' },
          // Never offered to the model, so it is dropped — and must not inflate resultCount.
          { assetId: '6aab2a45c6e457e01ac09fff', reason: 'Hallucinated.' },
        ],
        clarification: null,
      }),
    );

    const result = await getAlternatives(ORG, MEMBER, r6.id);

    expect(result.aiAssisted).toBe(true);
    const row = await oneRow();
    expect(row).toMatchObject({
      kind: 'alternatives',
      aiAssisted: true,
      fallbackReason: null,
      candidateCount: 1,
      resultCount: 1,
    });
    expect(String(row.assetId)).toBe(r6.id);
  });

  it('Foundry down: records unavailable, and the member still gets the unranked suggestions', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    const r6 = await assetWithUnits({ name: 'Canon R6', category: 'camera' }, [UNIT_STATUS.OUT]);
    await assetWithUnits({ name: 'Sony A7', category: 'camera' }, [UNIT_STATUS.AVAILABLE]);
    foundry.foundryRequest.mockRejectedValue(new ServiceUnavailableError('down'));

    const result = await getAlternatives(ORG, MEMBER, r6.id);

    expect(result.alternatives.map((a) => a.name)).toEqual(['Sony A7']);
    expect(await oneRow()).toMatchObject({
      kind: 'alternatives',
      aiAssisted: false,
      fallbackReason: 'unavailable',
      candidateCount: 1,
      resultCount: 1,
    });
  });

  it('model broke the output contract: records contract, and the member still gets suggestions', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    const r6 = await assetWithUnits({ name: 'Canon R6', category: 'camera' }, [UNIT_STATUS.OUT]);
    await assetWithUnits({ name: 'Sony A7', category: 'camera' }, [UNIT_STATUS.AVAILABLE]);
    foundry.foundryRequest.mockResolvedValue(foundryReply('You could try the Sony A7 instead!'));

    const result = await getAlternatives(ORG, MEMBER, r6.id);

    expect(result.alternatives.map((a) => a.name)).toEqual(['Sony A7']);
    expect(await oneRow()).toMatchObject({
      kind: 'alternatives',
      aiAssisted: false,
      fallbackReason: 'contract',
      candidateCount: 1,
      resultCount: 1,
    });
  });

  it('a bug in the lookup records nothing, rather than reporting it as a fallback', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    const r6 = await assetWithUnits({ name: 'Canon R6', category: 'camera' }, [UNIT_STATUS.OUT]);
    await assetWithUnits({ name: 'Sony A7', category: 'camera' }, [UNIT_STATUS.AVAILABLE]);
    foundry.foundryRequest.mockRejectedValue(new TypeError('a programming error'));

    await expect(getAlternatives(ORG, MEMBER, r6.id)).rejects.toThrow(TypeError);
    expect(searchLogRepo.append).not.toHaveBeenCalled();
  });

  it('records nothing for an asset that does not exist (a 404, not a lookup)', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);

    await expect(getAlternatives(ORG, MEMBER, '6aab2a45c6e457e01ac09fff')).rejects.toThrow();

    expect(searchLogRepo.append).not.toHaveBeenCalled();
  });

  it('records nothing when the asset is not a dead end, because the pipeline never ran', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    const a7 = await assetWithUnits({ name: 'Sony A7', category: 'camera' }, [
      UNIT_STATUS.AVAILABLE,
    ]);

    await getAlternatives(ORG, MEMBER, a7.id);

    expect(searchLogRepo.append).not.toHaveBeenCalled();
  });
});

describe('SCRUM-206 AT-6: writing telemetry can never break a search', () => {
  beforeEach(() => {
    foundry.isFoundryEnabled.mockReturnValue(false);
  });

  it('a rejected write still returns the results, and is logged without the query', async () => {
    await assetRepo.create(ORG, { name: 'Epson Projector', category: 'AV' });
    searchLogRepo.append.mockRejectedValueOnce(new Error('database is down: projector'));

    const result = await searchAssets(ORG, 'projector');

    expect(result.matches.map((m) => m.name)).toEqual(['Epson Projector']);
    await vi.waitFor(() => expect(logLines.join('\n')).toContain('search telemetry write failed'));
    // Neither the query nor the error's message (which here quotes it) reaches the log.
    expect(logLines.join('\n')).not.toContain('projector');
  });

  it('a write that throws synchronously still returns the results', async () => {
    await assetRepo.create(ORG, { name: 'Epson Projector', category: 'AV' });
    searchLogRepo.append.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const result = await searchAssets(ORG, 'projector');

    expect(result.matches).toHaveLength(1);
  });

  it('a write that never finishes does not hold the search up', async () => {
    await assetRepo.create(ORG, { name: 'Epson Projector', category: 'AV' });
    searchLogRepo.append.mockImplementationOnce(() => new Promise(() => {}));

    // If the write were awaited this would hang until the test timed out.
    const result = await searchAssets(ORG, 'projector');

    expect(result.matches).toHaveLength(1);
  });

  it('alternatives survive a failed write too', async () => {
    const r6 = await assetWithUnits({ name: 'Canon R6', category: 'camera' }, [UNIT_STATUS.OUT]);
    await assetWithUnits({ name: 'Sony A7', category: 'camera' }, [UNIT_STATUS.AVAILABLE]);
    searchLogRepo.append.mockRejectedValueOnce(new Error('down'));

    const result = await getAlternatives(ORG, MEMBER, r6.id);

    expect(result.alternatives.map((a) => a.name)).toEqual(['Sony A7']);
  });
});
