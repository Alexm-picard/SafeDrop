/**
 * Unit tests for the AI-assisted asset search service (SCRUM-103).
 *
 * `foundry.client.js` is mocked for the whole suite: the model is slow, costs money and answers
 * differently each time, so these tests pin down the service's own decisions — what goes into the
 * prompt and what is trusted coming back — rather than the model's. The repositories are real and run
 * against the per-file in-memory database from tests/setup.js.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ai/foundry.client.js', () => ({
  isFoundryEnabled: vi.fn(),
  foundryRequest: vi.fn(),
  promptFingerprint: vi.fn(() => 'fingerprint'),
}));

// A real asset-search response, recorded once from the live agent with a fake catalogue. The model's
// JSON arrives as a string inside `output[type=message].content[type=output_text].text`, after a
// reasoning item — a shape a hand-written mock would not have guessed.
const recordedResponse = JSON.parse(
  readFileSync(
    new URL('../../fixtures/foundry/asset-search-response.json', import.meta.url),
    'utf8',
  ),
);

/** The recorded envelope, with the model's answer replaced by `answer` (an object, or raw text). */
function foundryReply(answer) {
  const reply = structuredClone(recordedResponse);
  const message = reply.output.find((item) => item.type === 'message');
  message.content[0].text = typeof answer === 'string' ? answer : JSON.stringify(answer);
  return reply;
}

const foundry = await import('../../../src/services/ai/foundry.client.js');
const assetRepo = await import('../../../src/repositories/asset.repository.js');
const unitRepo = await import('../../../src/repositories/assetUnit.repository.js');
const { searchAssets } = await import('../../../src/services/ai/assetSearch.service.js');

const ORG = '6aab2a45c6e457e01ac0968a';
const OTHER_ORG = '6aab2a45c6e457e01ac0968b';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SCRUM-103 AC1: plain search when AI is off', () => {
  beforeEach(() => {
    foundry.isFoundryEnabled.mockReturnValue(false);
  });

  it('matches name, description and category case-insensitively, without calling Foundry', async () => {
    const recorder = await assetRepo.create(ORG, { name: 'Zoom H5 Recorder', category: 'Audio' });
    const projector = await assetRepo.create(ORG, {
      name: 'Epson Projector',
      category: 'AV',
      description: 'Good for recording a lecture hall',
    });
    const mic = await assetRepo.create(ORG, { name: 'Shure SM58', category: 'Recording Gear' });
    await assetRepo.create(ORG, { name: 'Tripod', category: 'Camera Support' });

    const result = await searchAssets(ORG, 'RECORD');

    const ids = result.matches.map((m) => m.assetId);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining([recorder.id, projector.id, mic.id].map(String)));
    expect(result.aiAssisted).toBe(false);
    // AI is an enhancement, not a dependency: "off" must never reach the transport.
    expect(foundry.foundryRequest).not.toHaveBeenCalled();
  });

  it('treats the search text literally, so regex syntax cannot widen the match', async () => {
    // `.*` would match every asset if the text were used as a pattern. Escaping also keeps
    // catastrophic patterns such as `(a+)+$` (ReDoS) away from the database.
    await assetRepo.create(ORG, { name: 'Tripod', category: 'Camera Support' });

    const result = await searchAssets(ORG, '.*');

    expect(result.matches).toEqual([]);
  });
});

describe('SCRUM-103 AC3: AI-assisted search', () => {
  beforeEach(() => {
    foundry.isFoundryEnabled.mockReturnValue(true);
  });

  it("returns the model's matches in the model's order, with its clarification", async () => {
    const webcam = await assetRepo.create(ORG, { name: 'Logitech C920 Webcam', category: 'Video' });
    const recorder = await assetRepo.create(ORG, { name: 'Zoom H5 Recorder', category: 'Audio' });
    foundry.foundryRequest.mockResolvedValue(
      foundryReply({
        // Deliberately not alphabetical, so the model's ranking is distinguishable from a name sort.
        matches: [
          { assetId: recorder.id, reason: 'Handheld audio recorder.' },
          { assetId: webcam.id, reason: 'Can record video of a lecture.' },
        ],
        clarification: 'Do you need audio only, or video as well?',
      }),
    );

    const result = await searchAssets(ORG, 'something to record a lecture');

    expect(result.matches.map((m) => m.assetId)).toEqual([recorder.id, webcam.id]);
    expect(result.matches[0]).toMatchObject({
      name: 'Zoom H5 Recorder',
      reason: 'Handheld audio recorder.',
    });
    expect(result.clarification).toBe('Do you need audio only, or video as well?');
    expect(result.aiAssisted).toBe(true);
    expect(foundry.foundryRequest).toHaveBeenCalledOnce();
  });

  it('sends the prompt contract: the query and each candidate with its units, and nothing else', async () => {
    const recorder = await assetRepo.create(ORG, {
      name: 'Zoom H5 Recorder',
      category: 'Audio',
      description: 'Handheld audio recorder',
    });
    // The serial is on the unit but not in the contract, so it must not reach the model.
    await unitRepo.create(ORG, {
      assetId: recorder.id,
      tag: 'AUD-001',
      serial: 'SN-4471-PRIVATE',
      condition: 'GOOD',
      status: 'AVAILABLE',
    });
    foundry.foundryRequest.mockResolvedValue(foundryReply({ matches: [], clarification: null }));

    await searchAssets(ORG, 'something to record a lecture');

    const [orgId, body] = foundry.foundryRequest.mock.calls[0];
    expect(orgId).toBe(ORG);
    // Exact equality: an extra field anywhere (orgId, a unit id, the serial) fails the test.
    expect(JSON.parse(body.input)).toEqual({
      query: 'something to record a lecture',
      assets: [
        {
          id: recorder.id,
          name: 'Zoom H5 Recorder',
          category: 'Audio',
          description: 'Handheld audio recorder',
          units: [{ tag: 'AUD-001', status: 'AVAILABLE', condition: 'GOOD' }],
        },
      ],
    });
  });

  it('sends at most 100 candidates, capping how much catalogue goes into one AI call', async () => {
    await Promise.all(
      Array.from({ length: 101 }, (_, i) =>
        assetRepo.create(ORG, { name: `Asset ${String(i).padStart(3, '0')}`, category: 'Misc' }),
      ),
    );
    foundry.foundryRequest.mockResolvedValue(foundryReply({ matches: [], clarification: null }));

    await searchAssets(ORG, 'anything');

    const [, body] = foundry.foundryRequest.mock.calls[0];
    expect(JSON.parse(body.input).assets).toHaveLength(100);
  });

  it('puts plain-search matches first, so a match beyond the cap still reaches the model', async () => {
    await Promise.all(
      Array.from({ length: 101 }, (_, i) =>
        assetRepo.create(ORG, { name: `Asset ${String(i).padStart(3, '0')}`, category: 'Misc' }),
      ),
    );
    // Sorts last by name, so a name-ordered page of 100 would leave it out.
    const recorder = await assetRepo.create(ORG, { name: 'Zoom H5 Recorder', category: 'Audio' });
    foundry.foundryRequest.mockResolvedValue(foundryReply({ matches: [], clarification: null }));

    await searchAssets(ORG, 'recorder');

    const [, body] = foundry.foundryRequest.mock.calls[0];
    const sentIds = JSON.parse(body.input).assets.map((asset) => asset.id);
    expect(sentIds).toContain(recorder.id);
    // Matches go in *within* the cap, not on top of it.
    expect(sentIds).toHaveLength(100);
  });

  // Regression guard, not a red: this passed before plain-search matches were merged in, because
  // nothing could overlap yet. It exists to catch a merge that lets a duplicate take a slot.
  it('sends an asset found by both the plain search and the catalogue page only once', async () => {
    await Promise.all(
      Array.from({ length: 101 }, (_, i) =>
        assetRepo.create(ORG, { name: `Asset ${String(i).padStart(3, '0')}`, category: 'Misc' }),
      ),
    );
    foundry.foundryRequest.mockResolvedValue(foundryReply({ matches: [], clarification: null }));

    // Matches Asset 000–009, which are also on the first page of the catalogue.
    await searchAssets(ORG, 'asset 00');

    const [, body] = foundry.foundryRequest.mock.calls[0];
    const sentIds = JSON.parse(body.input).assets.map((asset) => asset.id);
    expect(new Set(sentIds).size).toBe(sentIds.length);
    expect(sentIds).toHaveLength(100);
  });

  it('AC3b: drops any assetId the model returns that was not among the candidates sent', async () => {
    const recorder = await assetRepo.create(ORG, { name: 'Zoom H5 Recorder', category: 'Audio' });
    // A real asset, but another tenant's: it can only appear in the answer through injection or a
    // leak, and trusting it would show org B's catalogue to an org A member (SR-2).
    const foreign = await assetRepo.create(OTHER_ORG, {
      name: 'Sony A7 Camera',
      category: 'Video',
    });
    const invented = '6aab2a45c6e457e01ac0ffff'; // exists nowhere: a hallucinated id
    foundry.foundryRequest.mockResolvedValue(
      foundryReply({
        matches: [
          { assetId: invented, reason: 'Best match for recording.' },
          { assetId: recorder.id, reason: 'Handheld audio recorder.' },
          { assetId: foreign.id, reason: 'Camera for filming a lecture.' },
        ],
        clarification: null,
      }),
    );

    const result = await searchAssets(ORG, 'something to record a lecture');

    expect(result.matches.map((m) => m.assetId)).toEqual([recorder.id]);
  });
});

describe('SCRUM-103 AC4: unusable model output falls back to plain search', () => {
  beforeEach(() => {
    foundry.isFoundryEnabled.mockReturnValue(true);
  });

  it('falls back when the model answers in prose instead of JSON', async () => {
    const recorder = await assetRepo.create(ORG, { name: 'Zoom H5 Recorder', category: 'Audio' });
    await assetRepo.create(ORG, { name: 'Tripod', category: 'Camera Support' });
    foundry.foundryRequest.mockResolvedValue(foundryReply("Sorry, I can't help with that."));

    const result = await searchAssets(ORG, 'recorder');

    expect(result).toMatchObject({ aiAssisted: false, clarification: null });
    expect(result.matches.map((m) => m.assetId)).toEqual([recorder.id]);
  });

  it('falls back when the JSON does not fit the output contract', async () => {
    const recorder = await assetRepo.create(ORG, { name: 'Zoom H5 Recorder', category: 'Audio' });
    // Parses fine, but `matches` is missing: the shape a drifting prompt or model would produce.
    foundry.foundryRequest.mockResolvedValue(
      foundryReply({ results: [{ id: recorder.id }], clarification: null }),
    );

    const result = await searchAssets(ORG, 'recorder');

    expect(result).toMatchObject({ aiAssisted: false, clarification: null });
    expect(result.matches.map((m) => m.assetId)).toEqual([recorder.id]);
  });
});
