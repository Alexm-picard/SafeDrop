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
import { ServiceUnavailableError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { restrictionsOf } from '../asset.service.js';
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
