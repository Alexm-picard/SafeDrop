/**
 * Unit tests for the AI-assisted asset search service (SCRUM-103).
 *
 * `foundry.client.js` is mocked for the whole suite: the model is slow, costs money and answers
 * differently each time, so these tests pin down the service's own decisions — what goes into the
 * prompt and what is trusted coming back — rather than the model's. The repositories are real and run
 * against the per-file in-memory database from tests/setup.js.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ai/foundry.client.js', () => ({
  isFoundryEnabled: vi.fn(),
  foundryRequest: vi.fn(),
  promptFingerprint: vi.fn(() => 'fingerprint'),
}));

const foundry = await import('../../../src/services/ai/foundry.client.js');
const assetRepo = await import('../../../src/repositories/asset.repository.js');
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
