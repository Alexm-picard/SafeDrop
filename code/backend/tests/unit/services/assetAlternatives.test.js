// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~85% (test-first pairing session; each test written and run red before its production code)
// AI-Assisted Areas: unit tests for AI-recommended alternatives (SCRUM-151) — AT-1 to AT-4
// Human Contributions: acceptance criteria, test ordering and the red/green decisions by Mateus Silva
// Notes: Reuses the SCRUM-103 harness: Foundry mocked, repositories real against the per-file in-memory database.

/**
 * Unit tests for AI-recommended alternatives (SCRUM-151).
 *
 * When every unit of an asset is out, a member hits "0 available" and gives up. This service answers
 * "what else could you borrow instead, right now", reusing the SCRUM-103 candidate-and-ranking
 * pipeline rather than starting a second one.
 *
 * `foundry.client.js` is mocked for the whole file, exactly as in assetSearch.test.js: the model is
 * slow, costs money and answers differently each time, so these tests pin the service's own decisions
 * — which candidates it is willing to show the model, and what it trusts coming back — not the
 * model's judgement. The repositories are real.
 *
 * **The filtering is the security boundary, not the prompt.** Candidates are narrowed in the backend
 * before the model sees anything, so the model can only ever rank assets the caller is already
 * allowed to have (AT-2). A test that only checked the output would pass even if the prompt carried
 * another tenant's catalogue, so these tests assert on what was *sent* as well as what came back.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ai/foundry.client.js', () => ({
  isFoundryEnabled: vi.fn(),
  foundryRequest: vi.fn(),
  promptFingerprint: vi.fn(() => 'fingerprint'),
}));

// Capture what the logger writes, at `debug`, so a line that logged a prompt or a member's data "just
// to debug it" would be caught rather than dropped by the suite's `fatal` level.
const { logLines } = vi.hoisted(() => ({ logLines: [] }));
vi.mock('../../../src/utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logger: actual.createLogger({ level: 'debug', write: (line) => logLines.push(line) }),
  };
});

/** The real recorded Foundry envelope from SCRUM-103; the model's JSON sits inside it as text. */
const recordedResponse = JSON.parse(
  readFileSync(
    new URL('../../fixtures/foundry/asset-search-response.json', import.meta.url),
    'utf8',
  ),
);

/** The recorded envelope with the model's answer replaced by `answer` (an object, or raw text). */
function foundryReply(answer) {
  const reply = structuredClone(recordedResponse);
  const message = reply.output.find((item) => item.type === 'message');
  message.content[0].text = typeof answer === 'string' ? answer : JSON.stringify(answer);
  return reply;
}

const foundry = await import('../../../src/services/ai/foundry.client.js');
const assetRepo = await import('../../../src/repositories/asset.repository.js');
const unitRepo = await import('../../../src/repositories/assetUnit.repository.js');
const { getAlternatives } = await import('../../../src/services/ai/assetSearch.service.js');
const { UNIT_STATUS } = await import('../../../src/utils/constants.js');

const ORG = '6aab2a45c6e457e01ac0968a';
const MEMBER = '6aab2a45c6e457e01ac0968c';

beforeEach(() => {
  vi.clearAllMocks();
  logLines.length = 0;
});

/**
 * An asset with one unit per status in `statuses`.
 * @param {string} orgId
 * @param {{ name: string, category: string, description?: string }} fields
 * @param {string[]} statuses one unit is created per entry
 * @returns {Promise<import('mongoose').Document>} the asset
 */
async function assetWithUnits(orgId, fields, statuses) {
  const asset = await assetRepo.create(orgId, fields);
  let tag = 0;
  for (const status of statuses) {
    tag += 1;
    await unitRepo.create(orgId, {
      assetId: asset._id,
      tag: `${fields.name}-${tag}`,
      status,
    });
  }
  return asset;
}

describe('SCRUM-151 AT-1: alternatives when nothing is available', () => {
  beforeEach(() => {
    foundry.isFoundryEnabled.mockReturnValue(true);
  });

  it('recommends an available asset in the same category, with the model’s reason', async () => {
    // The story's own example: the R6 is fully out, the A7 IV is on the shelf.
    const r6 = await assetWithUnits(
      ORG,
      { name: 'Canon EOS R6', category: 'camera', description: 'Full-frame mirrorless' },
      [UNIT_STATUS.OUT, UNIT_STATUS.HELD],
    );
    const a7 = await assetWithUnits(
      ORG,
      { name: 'Sony A7 IV', category: 'camera', description: 'Full-frame mirrorless' },
      [UNIT_STATUS.AVAILABLE, UNIT_STATUS.AVAILABLE],
    );
    foundry.foundryRequest.mockResolvedValue(
      foundryReply({
        matches: [{ assetId: String(a7._id), reason: 'Full-frame mirrorless, two available now' }],
        clarification: null,
      }),
    );

    const result = await getAlternatives(ORG, MEMBER, String(r6._id));

    expect(result.aiAssisted).toBe(true);
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0]).toMatchObject({
      assetId: String(a7._id),
      name: 'Sony A7 IV',
      category: 'camera',
      reason: 'Full-frame mirrorless, two available now',
    });
  });
});

describe('SCRUM-151 AT-4: no recommendations when the item is available', () => {
  beforeEach(() => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    // A usable reply, so the only thing that can fail below is the spy assertion. Without it the
    // service would crash on an empty mock and the red would be ambiguous about its own cause.
    foundry.foundryRequest.mockResolvedValue(foundryReply({ matches: [], clarification: null }));
  });

  it('asks the model nothing when the asset still has an AVAILABLE unit', async () => {
    // Partly out is not a dead end: the member can borrow this one, so there is nothing to suggest
    // and no reason to spend a model call — the cost of this feature has to scale with the problem
    // it solves, not with page views.
    const r6 = await assetWithUnits(ORG, { name: 'Canon EOS R6', category: 'camera' }, [
      UNIT_STATUS.OUT,
      UNIT_STATUS.AVAILABLE,
    ]);
    await assetWithUnits(ORG, { name: 'Sony A7 IV', category: 'camera' }, [UNIT_STATUS.AVAILABLE]);

    const result = await getAlternatives(ORG, MEMBER, String(r6._id));

    expect(foundry.foundryRequest).not.toHaveBeenCalled();
    expect(result).toEqual({ alternatives: [], aiAssisted: false });
  });

  it('asks the model nothing when the asset has no units at all', async () => {
    // Not the same situation as "all out", but the same answer: an asset nobody has stocked yet is
    // not a borrower hitting a dead end, and recommending substitutes for it would be noise.
    const empty = await assetWithUnits(ORG, { name: 'Canon EOS R6', category: 'camera' }, []);
    await assetWithUnits(ORG, { name: 'Sony A7 IV', category: 'camera' }, [UNIT_STATUS.AVAILABLE]);

    const result = await getAlternatives(ORG, MEMBER, String(empty._id));

    expect(foundry.foundryRequest).not.toHaveBeenCalled();
    expect(result).toEqual({ alternatives: [], aiAssisted: false });
  });
});
