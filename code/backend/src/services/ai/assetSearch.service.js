/**
 * AI-assisted asset search (SCRUM-103).
 *
 * A member describes what they need in plain words and gets matching items from their own
 * organisation's catalogue. The plain search is the base behaviour; the model is an enhancement over
 * it, never a dependency (services/ai/README.md).
 *
 * Exports: `searchAssets(orgId, query)`.
 */
import * as assetRepo from '../../repositories/asset.repository.js';

/**
 * Search the caller's catalogue.
 * @param {string} orgId tenant id, from the verified token
 * @param {string} query what the member typed
 * @returns {Promise<{ matches: object[], clarification: string|null, aiAssisted: boolean }>}
 */
export async function searchAssets(orgId, query) {
  const assets = await assetRepo.search(orgId, query);
  return {
    matches: assets.map((asset) => ({
      assetId: String(asset._id),
      name: asset.name,
      category: asset.category,
      description: asset.description,
    })),
    clarification: null,
    aiAssisted: false,
  };
}
