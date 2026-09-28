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
 * Exports: `searchAssets(orgId, query)`.
 */
import * as assetRepo from '../../repositories/asset.repository.js';
import * as unitRepo from '../../repositories/assetUnit.repository.js';
import { foundryRequest, isFoundryEnabled } from './foundry.client.js';

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

  const { items: candidates } = await assetRepo.list(orgId);
  const units = await unitRepo.listByAssets(
    orgId,
    candidates.map((asset) => asset._id),
  );
  const input = JSON.stringify({ query, assets: toPromptAssets(candidates, units) });
  const response = await foundryRequest(orgId, { input }, { prompt: input });
  const answer = JSON.parse(outputText(response));

  const byId = new Map(candidates.map((asset) => [String(asset._id), asset]));
  return {
    matches: answer.matches.map(({ assetId, reason }) => ({
      assetId,
      ...describe(byId.get(assetId)),
      reason,
    })),
    clarification: answer.clarification,
    aiAssisted: true,
  };
}

/** The catalogue fallback: a case-insensitive match on name, description and category. */
async function plainSearch(orgId, query) {
  const assets = await assetRepo.search(orgId, query);
  return {
    matches: assets.map((asset) => ({ assetId: String(asset._id), ...describe(asset) })),
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
  return { name: asset?.name, category: asset?.category, description: asset?.description };
}

/**
 * The model's text from a Responses-protocol body. It sits in the `message` item's `output_text`
 * part, found by type rather than position: a `reasoning` item comes first.
 */
function outputText(response) {
  const message = response.output.find((item) => item.type === 'message');
  return message.content.find((part) => part.type === 'output_text').text;
}
