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
});
