// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (inferred: 10 of 16 commits co-authored by Claude Code)
// AI-Assisted Areas: AC1 plain catalogue search (SCRUM-103, SCRUM-146, SCRUM-200, SCRUM-151, SCRUM-185)
// Human Contributions: reviewed and approved by Alex Picard (PR #49, 2026-09-28); latest changes reviewed and approved by Alex Picard (PR #63, 2026-10-04); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: header added for SCRUM-216; the file had none.

/**
 * AI-assisted asset search (SCRUM-103).
 *
 * A member describes what they need in plain words and gets matching items from their own
 * organisation's catalogue. The plain search is the base behaviour; the model is an enhancement over
 * it, never a dependency (services/ai/README.md).
 *
 * With AI on, the backend picks the candidate assets itself — tenant-scoped, through the repository —
 * and passes them to the model as data. The model only ranks; it never has access to the database
 * (prompts/asset-search.md, "Why the agent is not connected to MongoDB").
 *
 * Every match carries `allowedGroups` and `restricted` (SCRUM-202), so search results can show the
 * Restricted badge like the catalogue list. They are added after the search and never sent to the
 * model: the prompt contract stays exactly as it was.
 *
 * Exports: `searchAssets(orgId, query)`.
 */
import * as assetRepo from '../../repositories/asset.repository.js';
import * as unitRepo from '../../repositories/assetUnit.repository.js';
import { z } from 'zod';
import { UNIT_STATUS } from '../../utils/constants.js';
import { NotFoundError, ServiceUnavailableError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { restrictionsOf } from '../asset.service.js';
import { filterEligible } from '../group.service.js';
import { foundryRequest, isFoundryEnabled } from './foundry.client.js';

const log = logger.child({ component: 'asset-search' });

/**
 * The model's output contract, exactly as prompts/asset-search.md states it. Anything that does not
 * fit — prose, a renamed field, more than ten matches — is treated as no answer at all rather than
 * partly trusted, because a reply that has drifted from the contract in one place may have drifted
 * in others.
 */
const answerSchema = z.object({
  matches: z.array(z.object({ assetId: z.string(), reason: z.string() })).max(10),
  clarification: z.string().nullable(),
});

/**
 * The most catalogue entries sent to the model in one call. Each costs tokens on every search (about
 * 250 with its units, measured against the live agent), so this bounds both cost and how much of a
 * tenant's data leaves the backend per request.
 */
const MAX_CANDIDATES = 100;

/**
 * The most results a plain search returns (SCRUM-146). Results are ranked by name, so a member who
 * does not see what they want refines the query rather than paging; the cap bounds the response size
 * and what Mongo loads for a one-letter query.
 */
const PLAIN_SEARCH_LIMIT = 50;

/**
 * The most alternatives a dead-end page offers (SCRUM-151). A member who cannot have the thing they
 * came for needs a handful of options to choose between, not a second catalogue to search.
 */
const MAX_ALTERNATIVES = 5;

/**
 * Search the caller's catalogue.
 * @param {string} orgId tenant id, from the verified token
 * @param {string} query what the member typed
 * @returns {Promise<{ matches: object[], clarification: string|null, aiAssisted: boolean }>}
 */
export async function searchAssets(orgId, query) {
  if (!isFoundryEnabled()) {
    return plainSearch(orgId, query);
  }

  const candidates = await pickCandidates(orgId, query);
  const units = await unitRepo.listByAssets(
    orgId,
    candidates.map((asset) => asset._id),
  );
  const input = JSON.stringify({ query, assets: toPromptAssets(candidates, units) });
  let response;
  try {
    response = await foundryRequest(orgId, { input }, { prompt: input });
  } catch (err) {
    // The transport turns every upstream failure into this one class, so it means "the AI is down",
    // and the member still gets plain search (SCRUM-103 AT2). Anything else is a bug here and is
    // rethrown: catching it too would report a defect as an outage and hide it.
    if (!(err instanceof ServiceUnavailableError)) {
      throw err;
    }
    log.warn({ orgId }, 'Foundry unavailable; used plain search');
    return plainSearch(orgId, query);
  }
  const answer = readAnswer(response);
  if (!answer) {
    // AI is an enhancement, not a dependency: an unusable answer costs the member the ranking,
    // never the search. Logged so a prompt or model change that breaks the contract is noticed
    // rather than silently turning every search into a plain one — but only the org, never the
    // query or the reply, which can quote catalogue data and member names.
    log.warn({ orgId }, 'model output did not fit the asset-search contract; used plain search');
    return plainSearch(orgId, query);
  }

  // The candidates sent are the only ids the model may return (prompt rule 1). Anything else — a
  // hallucinated id, or another tenant's id smuggled in by injection — is dropped, not looked up:
  // a lookup would still accept an id from this org that was never offered to the model.
  const byId = new Map(candidates.map((asset) => [String(asset._id), asset]));
  const kept = answer.matches.filter(({ assetId }) => byId.has(assetId));
  const restrictions = await restrictionsOf(
    orgId,
    kept.map(({ assetId }) => byId.get(assetId)),
  );
  return {
    matches: kept.map(({ assetId, reason }, i) => ({
      assetId,
      ...describe(byId.get(assetId)),
      reason,
      ...restrictions[i],
    })),
    clarification: answer.clarification,
    aiAssisted: true,
  };
}

/**
 * Comparable items a member could borrow instead (SCRUM-151).
 *
 * The dead end this removes: an asset whose every unit is out shows "0 available", and the member
 * emails somebody instead of borrowing the equivalent item on the next shelf.
 *
 * **The asset itself is the query.** Its name, category and description describe what the member
 * wanted, so they go to the model in place of typed words and the SCRUM-103 candidate-and-ranking
 * pipeline is reused unchanged — one prompt contract, one place where model output is validated.
 *
 * **Every failure is a fallback, never an error (AT-3).** Foundry switched off, unreachable, or
 * answering outside its contract all end in the same place: the candidates the backend had already
 * chosen, unranked. A member at a dead end gets a worse answer, never an error page.
 * @param {string} orgId tenant id, from the verified token
 * @param {string} userId the caller, who must be eligible for anything recommended (AT-2)
 * @param {string} assetId the asset the member is looking at
 * @returns {Promise<{ alternatives: object[], aiAssisted: boolean }>}
 */
export async function getAlternatives(orgId, userId, assetId) {
  // Resolved first, and before the availability check below: that check would otherwise answer for a
  // missing asset, since an asset that does not exist has no units either — "nothing to suggest" with
  // a 200, for something that is not there. `findById` folds in `orgId`, so another organisation's id
  // and one that never existed are indistinguishable, and both answer 404 rather than 403 (SR-2).
  const asset = await assetRepo.findById(orgId, assetId);
  if (!asset) {
    throw new NotFoundError('Asset not found');
  }

  // **The model is not called unless the member is actually stuck (AT-4).** One AVAILABLE unit means
  // they can borrow this one, and an asset with no units at all is not a dead end either — nobody has
  // stocked it yet. Both answer "nothing to suggest" without a request, so the cost of this feature
  // scales with the problem it solves rather than with page views. One query answers both questions.
  const units = await unitRepo.listByAsset(orgId, assetId);
  const available = units.filter((unit) => unit.status === UNIT_STATUS.AVAILABLE).length;
  if (units.length === 0 || available > 0) {
    return { alternatives: [], aiAssisted: false };
  }

  // Chosen once, for both paths. The fallback is the same set unranked rather than a second,
  // narrower query, so what the section *contains* does not change when Foundry flaps — only whether
  // it is ordered and explained. It also means the AT-2 filters cannot be bypassed by the fallback,
  // which is the obvious way for this feature to leak.
  const { candidates, candidateUnits } = await recommendableCandidates(orgId, userId, asset);
  if (!isFoundryEnabled()) {
    return unranked(candidates);
  }

  const input = JSON.stringify({
    query: queryFor(asset),
    assets: toPromptAssets(candidates, candidateUnits),
  });
  let response;
  try {
    response = await foundryRequest(orgId, { input }, { prompt: input });
  } catch (err) {
    // The transport turns every upstream failure into this one class, so it means "the AI is down".
    // Anything else is a bug here and is rethrown: catching it too would report a defect as an
    // outage and hide it. The error's own message is never forwarded or logged — Foundry quotes the
    // offending request back, prompt included (services/ai/README.md).
    if (!(err instanceof ServiceUnavailableError)) {
      throw err;
    }
    log.warn({ orgId }, 'Foundry unavailable; alternatives returned unranked');
    return unranked(candidates);
  }

  const answer = readAnswer(response);
  if (!answer) {
    // Logged so a prompt or model change that breaks the contract is noticed rather than silently
    // turning every page into the fallback — but only the org, never the reply, which quotes
    // catalogue data.
    log.warn(
      { orgId },
      'model output did not fit the asset-search contract; alternatives returned unranked',
    );
    return unranked(candidates);
  }

  // Same rule as search: the candidates sent are the only ids the model may return (prompt rule 1),
  // and anything else is dropped rather than looked up.
  const byId = new Map(candidates.map((candidate) => [String(candidate._id), candidate]));
  return {
    // Capped like the fallback, and for the member's sake rather than the model's: the output
    // contract allows ten, so without this the section would hold ten options with Foundry up and
    // five with it down. Sliced after the whitelist filter, so dropping a hallucinated id promotes
    // the next real match instead of leaving a gap, and the model's own order is kept — its best
    // five, not an arbitrary five.
    alternatives: answer.matches
      .filter(({ assetId: id }) => byId.has(id))
      .slice(0, MAX_ALTERNATIVES)
      .map(({ assetId: id, reason }) => ({ assetId: id, ...describe(byId.get(id)), reason })),
    aiAssisted: true,
  };
}

/**
 * The assets this member could actually borrow instead, and their units (SCRUM-151 AT-2).
 *
 * Tenant scoping and the retired rule come free: every repository call folds in `orgId`, and
 * `search`/`list` exclude retired assets (SCRUM-145). What this adds is the two rules specific to a
 * *recommendation* — it has to be borrowable right now, and by this caller. Suggesting something the
 * member cannot request would hand them a second dead end, which is the thing the story removes.
 *
 * Both callers get the same set, so the filters are applied once and cannot be skipped by the
 * fallback path.
 */
async function recommendableCandidates(orgId, userId, asset) {
  const possible = (await pickCandidates(orgId, queryFor(asset))).filter(
    (candidate) => String(candidate._id) !== String(asset._id),
  );
  const possibleUnits = await unitRepo.listByAssets(
    orgId,
    possible.map((candidate) => candidate._id),
  );

  const unitsByAsset = Map.groupBy(possibleUnits, (unit) => String(unit.assetId));
  const borrowable = possible.filter((candidate) =>
    (unitsByAsset.get(String(candidate._id)) ?? []).some(
      (unit) => unit.status === UNIT_STATUS.AVAILABLE,
    ),
  );
  const candidates = await filterEligible(orgId, userId, borrowable);
  const keep = new Set(candidates.map((candidate) => String(candidate._id)));
  return {
    candidates,
    candidateUnits: possibleUnits.filter((unit) => keep.has(String(unit.assetId))),
  };
}

/**
 * The fallback answer (AT-3): the same candidates, in the order the backend chose, with no reason.
 *
 * `reason` is `null` rather than a sentence composed here. The field means "why the model picked
 * this", and writing plausible prose into it would attribute words to a model that never ran. The
 * page says "available now" from `aiAssisted: false` instead.
 */
function unranked(candidates) {
  return {
    alternatives: candidates.slice(0, MAX_ALTERNATIVES).map((candidate) => ({
      assetId: String(candidate._id),
      ...describe(candidate),
      reason: null,
    })),
    aiAssisted: false,
  };
}

/**
 * The asset's own words, standing in for the ones a member would have typed.
 *
 * Built by naming fields rather than serialising the document, so a field added to the model later —
 * or one that exists today, such as `imageUrl` — never reaches the model without a change here.
 */
function queryFor(asset) {
  return [asset.name, asset.category, asset.description].filter(Boolean).join(' ');
}

/**
 * The assets to send to the model: plain-search matches first, then the catalogue in name order,
 * up to `MAX_CANDIDATES`. Without the matches going first, an org with more assets than the cap
 * would never show the model anything past the first hundred names, however well it matched.
 * Keyed by id so an asset found both ways is sent once and does not take two slots. The matches are
 * fetched up to the candidate cap, not the plain-search cap: they fill candidate slots, and asking for
 * more than the cap would only load documents the slice below throws away.
 */
async function pickCandidates(orgId, query) {
  const [matched, { items: page }] = await Promise.all([
    assetRepo.search(orgId, query, { limit: MAX_CANDIDATES }),
    assetRepo.list(orgId, { limit: MAX_CANDIDATES }),
  ]);
  const byId = new Map();
  for (const asset of [...matched, ...page]) {
    const id = String(asset._id);
    if (!byId.has(id)) {
      byId.set(id, asset);
    }
  }
  return [...byId.values()].slice(0, MAX_CANDIDATES);
}

/** The catalogue fallback: a case-insensitive match on name, description and category. */
async function plainSearch(orgId, query) {
  const assets = await assetRepo.search(orgId, query, { limit: PLAIN_SEARCH_LIMIT });
  const restrictions = await restrictionsOf(orgId, assets);
  return {
    matches: assets.map((asset, i) => ({
      assetId: String(asset._id),
      ...describe(asset),
      ...restrictions[i],
    })),
    clarification: null,
    aiAssisted: false,
  };
}

/**
 * The candidates exactly as the prompt contract describes them (prompts/asset-search.md): each
 * field is picked by name, so a field added to a model later — or one that exists today, such as a
 * unit's serial — never reaches the model without a change here.
 */
function toPromptAssets(candidates, units) {
  const unitsByAsset = Map.groupBy(units, (unit) => String(unit.assetId));
  return candidates.map((asset) => ({
    id: String(asset._id),
    ...describe(asset),
    units: (unitsByAsset.get(String(asset._id)) ?? []).map(({ tag, status, condition }) => ({
      tag,
      status,
      condition,
    })),
  }));
}

/** The asset fields a search result shows. */
function describe(asset) {
  return { name: asset.name, category: asset.category, description: asset.description };
}

/**
 * The model's answer, parsed and checked against the output contract, or `null` when it is unusable.
 *
 * The text sits in the `message` item's `output_text` part of a Responses-protocol body, found by
 * type rather than position because a `reasoning` item comes first. A body with no such part, text
 * that is not JSON, and JSON of the wrong shape all come back as `null`.
 */
function readAnswer(response) {
  const text = response.output
    ?.find((item) => item.type === 'message')
    ?.content?.find((part) => part.type === 'output_text')?.text;
  if (typeof text !== 'string') {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = answerSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
