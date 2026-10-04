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
const groupService = await import('../../../src/services/group.service.js');
const { UNIT_STATUS } = await import('../../../src/utils/constants.js');
const { seedTwoOrgs } = await import('../../helpers/seedTwoOrgs.js');
const { ServiceUnavailableError } = await import('../../../src/utils/errors.js');

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

describe('SCRUM-151: at most five alternatives, whichever path answered', () => {
  beforeEach(() => {
    foundry.isFoundryEnabled.mockReturnValue(true);
  });

  it('caps the model’s ranking at five, though its own contract allows ten', async () => {
    // Without this the section's length depends on whether Foundry is up: ten with AI, five from the
    // fallback, for the same member on the same page. The cap belongs to the feature, not to one path.
    const stuck = await assetWithUnits(
      ORG,
      { name: 'Canon EOS R6', category: 'camera', description: 'Full-frame mirrorless' },
      [UNIT_STATUS.OUT],
    );
    const spares = [];
    for (let i = 0; i < 8; i += 1) {
      spares.push(
        await assetWithUnits(
          ORG,
          { name: `Spare camera ${i}`, category: 'camera', description: 'Full-frame mirrorless' },
          [UNIT_STATUS.AVAILABLE],
        ),
      );
    }
    foundry.foundryRequest.mockResolvedValue(
      foundryReply({
        matches: spares.map((spare) => ({ assetId: String(spare._id), reason: 'Comparable item' })),
        clarification: null,
      }),
    );

    const result = await getAlternatives(ORG, MEMBER, String(stuck._id));

    expect(result.aiAssisted).toBe(true);
    expect(result.alternatives).toHaveLength(5);
    // The model's own order survives the cap: its best five, not an arbitrary five.
    expect(result.alternatives.map((a) => a.assetId)).toEqual(
      spares.slice(0, 5).map((spare) => String(spare._id)),
    );
  });
});

describe('SCRUM-151 AT-2: recommendations respect every boundary', () => {
  let seed;
  /** Org A's fully-out camera: the asset a member is looking at when they hit the dead end. */
  let stuckOn;

  beforeEach(async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    seed = await seedTwoOrgs();
    stuckOn = await assetWithUnits(
      seed.a.orgId,
      { name: 'Canon EOS R6', category: 'camera', description: 'Full-frame mirrorless' },
      [UNIT_STATUS.OUT, UNIT_STATUS.HELD],
    );
  });

  /**
   * The ids of the assets actually sent to the model on the first call.
   *
   * Asserting on the prompt is the point of these tests. A filter that was never written would still
   * produce a clean *result* whenever the model happened not to mention the forbidden asset, so a
   * test that only read the return value would pass for the wrong reason. What the backend was
   * willing to show the model is the boundary.
   */
  function assetIdsSentToModel() {
    const [, body] = foundry.foundryRequest.mock.calls[0];
    return JSON.parse(body.input).assets.map((asset) => asset.id);
  }

  /** Make the model name `assetId` as its single recommendation, so a missing filter cannot hide. */
  function modelRecommends(assetId) {
    foundry.foundryRequest.mockResolvedValue(
      foundryReply({
        matches: [{ assetId: String(assetId), reason: 'Comparable item' }],
        clarification: null,
      }),
    );
  }

  it('never another organisation’s asset, even when the model names it (SR-2)', async () => {
    const theirs = await assetWithUnits(
      seed.b.orgId,
      { name: 'Sony A7 IV', category: 'camera', description: 'Full-frame mirrorless' },
      [UNIT_STATUS.AVAILABLE],
    );
    modelRecommends(theirs._id);

    const result = await getAlternatives(
      seed.a.orgId,
      String(seed.a.member._id),
      String(stuckOn._id),
    );

    expect(assetIdsSentToModel()).not.toContain(String(theirs._id));
    expect(result.alternatives).toEqual([]);
  });

  it('never a retired asset', async () => {
    const retired = await assetWithUnits(
      seed.a.orgId,
      { name: 'Nikon D750', category: 'camera', description: 'Full-frame DSLR' },
      [UNIT_STATUS.AVAILABLE],
    );
    await assetRepo.retire(seed.a.orgId, String(retired._id));
    modelRecommends(retired._id);

    const result = await getAlternatives(
      seed.a.orgId,
      String(seed.a.member._id),
      String(stuckOn._id),
    );

    // Retirement is a soft delete: nobody can borrow it, so suggesting it is the dead end again.
    expect(assetIdsSentToModel()).not.toContain(String(retired._id));
    expect(result.alternatives).toEqual([]);
  });

  it('never an asset with no AVAILABLE units', async () => {
    const alsoOut = await assetWithUnits(
      seed.a.orgId,
      { name: 'Sony A7 IV', category: 'camera', description: 'Full-frame mirrorless' },
      [UNIT_STATUS.OUT, UNIT_STATUS.REQUESTED, UNIT_STATUS.MAINTENANCE],
    );
    modelRecommends(alsoOut._id);

    const result = await getAlternatives(
      seed.a.orgId,
      String(seed.a.member._id),
      String(stuckOn._id),
    );

    // "Available right now" is the whole promise of the section. MAINTENANCE counts as unavailable
    // here exactly as OUT does (SCRUM-141).
    expect(assetIdsSentToModel()).not.toContain(String(alsoOut._id));
    expect(result.alternatives).toEqual([]);
  });

  it('never an asset restricted to a group the caller is not in', async () => {
    const { group } = await groupService.createGroup(
      seed.a.orgId,
      { userId: String(seed.a.admin._id), role: 'ORG_ADMIN' },
      { name: 'Certified Drone Pilots' },
    );
    const restricted = await assetRepo.create(seed.a.orgId, {
      name: 'Sony A7 IV',
      category: 'camera',
      description: 'Full-frame mirrorless',
      allowedGroupIds: [group.id],
    });
    await unitRepo.create(seed.a.orgId, {
      assetId: restricted._id,
      tag: 'a7-1',
      status: UNIT_STATUS.AVAILABLE,
    });
    modelRecommends(restricted._id);

    const result = await getAlternatives(
      seed.a.orgId,
      String(seed.a.member._id),
      String(stuckOn._id),
    );

    // Filtered before the model sees it, not after it answers: the model can only ever rank assets
    // the caller is already allowed to have. Recommending one they cannot request would hand them a
    // second dead end, which is the thing this story exists to remove.
    expect(assetIdsSentToModel()).not.toContain(String(restricted._id));
    expect(result.alternatives).toEqual([]);
  });

  it('does recommend a restricted asset the caller IS eligible for', async () => {
    // The other half of the rule, so the filter cannot pass by excluding everything restricted.
    const { group } = await groupService.createGroup(
      seed.a.orgId,
      { userId: String(seed.a.admin._id), role: 'ORG_ADMIN' },
      { name: 'Certified Drone Pilots' },
    );
    await groupService.addGroupMember(
      seed.a.orgId,
      { userId: String(seed.a.admin._id), role: 'ORG_ADMIN' },
      group.id,
      String(seed.a.member._id),
    );
    const restricted = await assetRepo.create(seed.a.orgId, {
      name: 'Sony A7 IV',
      category: 'camera',
      description: 'Full-frame mirrorless',
      allowedGroupIds: [group.id],
    });
    await unitRepo.create(seed.a.orgId, {
      assetId: restricted._id,
      tag: 'a7-1',
      status: UNIT_STATUS.AVAILABLE,
    });
    modelRecommends(restricted._id);

    const result = await getAlternatives(
      seed.a.orgId,
      String(seed.a.member._id),
      String(stuckOn._id),
    );

    expect(assetIdsSentToModel()).toContain(String(restricted._id));
    expect(result.alternatives.map((a) => a.assetId)).toEqual([String(restricted._id)]);
  });
});

/**
 * AT-3, the fallback. Three different upstream failures, one behaviour: the section still renders.
 *
 * **Deviation from AT-3 as written, agreed with the Requirements lead.** The criterion says "up to
 * five available assets from the same category". The fallback here instead uses the *same* candidate
 * set as the AI path — the whole catalogue, narrowed by the AT-2 filters — capped at five. The reason
 * is that Foundry can be up for one request and down for the next, and a fallback scoped more narrowly
 * than the AI path would make the section's contents visibly change kind rather than just lose their
 * ranking. The ticket and the Iteration 2 STD need updating to match.
 *
 * Fallback entries carry `reason: null`. Without the model there is no explanation to show, and
 * writing a plausible-sounding one in the service would put words in the model's mouth.
 */
describe('SCRUM-151 AT-3: graceful fallback without AI', () => {
  let seed;
  let stuckOn;
  let onTheShelf;

  beforeEach(async () => {
    seed = await seedTwoOrgs();
    stuckOn = await assetWithUnits(
      seed.a.orgId,
      { name: 'Canon EOS R6', category: 'camera', description: 'Full-frame mirrorless' },
      [UNIT_STATUS.OUT, UNIT_STATUS.HELD],
    );
    onTheShelf = await assetWithUnits(
      seed.a.orgId,
      { name: 'Sony A7 IV', category: 'camera', description: 'Full-frame mirrorless' },
      [UNIT_STATUS.AVAILABLE],
    );
  });

  const alternativesFor = () =>
    getAlternatives(seed.a.orgId, String(seed.a.member._id), String(stuckOn._id));

  it('falls back when Foundry is switched off, without calling it', async () => {
    foundry.isFoundryEnabled.mockReturnValue(false);

    const result = await alternativesFor();

    expect(foundry.foundryRequest).not.toHaveBeenCalled();
    expect(result.aiAssisted).toBe(false);
    expect(result.alternatives.map((a) => a.assetId)).toContain(String(onTheShelf._id));
    // No model, so no explanation — rather than prose invented here and attributed to one.
    expect(result.alternatives.every((a) => a.reason === null)).toBe(true);
  });

  it('falls back when the call to Foundry fails', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    // The transport turns every upstream failure — timeout, 500, bad key — into this one class.
    foundry.foundryRequest.mockRejectedValue(new ServiceUnavailableError('Foundry unavailable'));

    const result = await alternativesFor();

    expect(result.aiAssisted).toBe(false);
    expect(result.alternatives.map((a) => a.assetId)).toContain(String(onTheShelf._id));
  });

  it('falls back when the model’s output does not fit the contract', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    foundry.foundryRequest.mockResolvedValue(foundryReply('Sorry, I could not find anything.'));

    const result = await alternativesFor();

    expect(result.aiAssisted).toBe(false);
    expect(result.alternatives.map((a) => a.assetId)).toContain(String(onTheShelf._id));
  });

  it('never leaks upstream detail, and never logs the prompt or the reply', async () => {
    foundry.isFoundryEnabled.mockReturnValue(true);
    foundry.foundryRequest.mockRejectedValue(
      new ServiceUnavailableError('Foundry said: prompt was "Canon EOS R6 camera"'),
    );

    const result = await alternativesFor();

    // The member sees alternatives, not an outage. Nothing from upstream reaches them.
    expect(JSON.stringify(result)).not.toMatch(/Foundry|prompt/i);
    // And nothing at any level, debug included, carries the prompt or the catalogue text.
    expect(logLines.join('\n')).not.toMatch(/Canon EOS R6/);
  });

  it('applies the AT-2 filters on the fallback path too', async () => {
    // The easy bug: the fallback skips the pipeline and so skips its filters, quietly recommending an
    // unavailable or ineligible asset exactly when the AI is down.
    foundry.isFoundryEnabled.mockReturnValue(false);
    const alsoOut = await assetWithUnits(
      seed.a.orgId,
      { name: 'Nikon Z6', category: 'camera', description: 'Full-frame mirrorless' },
      [UNIT_STATUS.OUT],
    );
    const theirs = await assetWithUnits(
      seed.b.orgId,
      { name: 'Fujifilm X-T5', category: 'camera', description: 'Mirrorless' },
      [UNIT_STATUS.AVAILABLE],
    );
    const { group } = await groupService.createGroup(
      seed.a.orgId,
      { userId: String(seed.a.admin._id), role: 'ORG_ADMIN' },
      { name: 'Certified Drone Pilots' },
    );
    const restricted = await assetRepo.create(seed.a.orgId, {
      name: 'Hasselblad X2D',
      category: 'camera',
      allowedGroupIds: [group.id],
    });
    await unitRepo.create(seed.a.orgId, {
      assetId: restricted._id,
      tag: 'x2d-1',
      status: UNIT_STATUS.AVAILABLE,
    });

    const ids = (await alternativesFor()).alternatives.map((a) => a.assetId);

    expect(ids).toContain(String(onTheShelf._id));
    expect(ids).not.toContain(String(alsoOut._id));
    expect(ids).not.toContain(String(theirs._id));
    expect(ids).not.toContain(String(restricted._id));
    expect(ids).not.toContain(String(stuckOn._id));
  });

  it('returns at most five', async () => {
    foundry.isFoundryEnabled.mockReturnValue(false);
    for (let i = 0; i < 6; i += 1) {
      await assetWithUnits(
        seed.a.orgId,
        { name: `Spare camera ${i}`, category: 'camera', description: 'Full-frame mirrorless' },
        [UNIT_STATUS.AVAILABLE],
      );
    }

    const result = await alternativesFor();

    // A dead-end page needs a handful of options, not a second catalogue.
    expect(result.alternatives).toHaveLength(5);
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
