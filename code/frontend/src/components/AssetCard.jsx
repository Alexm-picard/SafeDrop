// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~95%
// AI-Assisted Areas: SCRUM-241 redesign: the catalog's gallery card, also the live preview on the asset form
// Human Contributions: pending team review
// Notes: Presentation only. Every field it shows is one the catalogue list or search already returns.

/**
 * One asset as a gallery card: a face (the asset's picture, or its category set large on a tinted
 * pegboard), its name, its category, the Restricted badge and, for an AI-assisted search, why it
 * matched.
 *
 * The whole card is one link, made with a stretched pseudo-element on the name's link, so a screen
 * reader hears one link named after the asset rather than a picture link and a text link side by side.
 *
 * Availability is not on the card: the catalogue list does not carry unit counts, and the asset's own
 * page lists every unit with its status.
 */
import { Link } from 'react-router';
import { ROUTES } from '../utils/constants';
import { RestrictedBadge } from './RestrictedBadge';

/** How many face tints there are (`data-tint` 0…3 in the stylesheet). */
const TINTS = 4;

/**
 * The word set on a picture-less face: the category, or its first four letters when the whole word
 * would not fit the card.
 * @param {string} category
 * @returns {string}
 */
function faceWord(category) {
  const word = (category ?? '').trim();
  if (!word) return 'New';
  const cased = word.charAt(0).toUpperCase() + word.slice(1);
  return cased.length <= 7 ? cased : cased.slice(0, 4);
}

/**
 * A stable tint for a category, so every camera shares a colour.
 * @param {string} category
 * @returns {number}
 */
function tintOf(category) {
  let hash = 0;
  for (const ch of (category ?? '').toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % TINTS;
}

/**
 * Render the card.
 * @param {{ id?: string, name: string, category: string, imageUrl?: string|null,
 *   allowedGroups?: { id: string, name: string }[], restricted?: boolean, reason?: string,
 *   preview?: boolean }} props `preview` renders it without a link, for the asset form
 * @returns {JSX.Element}
 */
export function AssetCard({
  id,
  name,
  category,
  imageUrl,
  allowedGroups,
  restricted,
  reason,
  preview = false,
}) {
  return (
    <article className="asset-card">
      <div className="asset-face" data-tint={tintOf(category)}>
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="asset-word" aria-hidden="true">
            {faceWord(category)}
          </span>
        )}
        <RestrictedBadge allowedGroups={allowedGroups} restricted={restricted} />
      </div>
      <div className="asset-body">
        <h3>{preview || !id ? name : <Link to={ROUTES.asset(id)}>{name}</Link>}</h3>
        <p className="asset-category">{category || 'No category yet'}</p>
        {reason ? <p className="asset-reason">{reason}</p> : null}
      </div>
    </article>
  );
}
