/**
 * Comparable items available right now (SCRUM-151).
 *
 * What a member sees instead of a dead end. "0 available" is where people give up and email somebody,
 * so this offers a handful of things they could borrow today, each as a link they can act on.
 *
 * **It renders nothing unless it has something useful to say.** No recommendations, a failed call, or
 * an asset that is not a dead end at all, and the section is absent entirely — not an empty heading,
 * and never an error panel. This is an extra offered at a moment of frustration: a member who came to
 * borrow a camera should not be told that a recommendation service is unwell (AT-3, which requires no
 * error text from upstream). The failure is already logged on the server, where someone can act on it.
 *
 * **`enabled` decides whether to ask at all.** The page passes false while any unit is available. The
 * API would answer an empty list anyway (AT-4), but the point of that criterion is that the feature
 * costs nothing when nobody is stuck, and one request per asset page view would undo it.
 */
import { Link } from 'react-router';
import { useAssetAlternatives } from '../hooks/useAssets';
import { ROUTES } from '../utils/constants';
import { LoadingState } from './LoadingState';

/** Ties the section to its heading, so it is announced by name rather than as an unlabelled region. */
const HEADING_ID = 'similar-items-heading';

/**
 * Render the section, or nothing.
 * @param {{ assetId: string, enabled: boolean }} props
 * @returns {JSX.Element|null}
 */
export function SimilarItems({ assetId, enabled }) {
  const { status, data } = useAssetAlternatives(assetId, enabled);

  if (!enabled) {
    return null;
  }
  if (status === 'loading' && !data) {
    return <LoadingState label="Loading similar items…" />;
  }

  // One branch for three situations that should look identical to a member: nothing was recommended,
  // the call failed (`data` stays null and `status` is 'error'), or the list came back empty.
  const items = data?.alternatives ?? [];
  if (items.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID}>Similar items available now</h2>
      <ul className="similar-items">
        {items.map((item) => (
          <li key={item.assetId}>
            <strong>{item.name}</strong>
            <br></br>
            {/*
              The model's one-line reason, or a plain statement of fact when it did not run. The
              backend sends `reason: null` on the fallback path rather than composing prose, so the
              only honest thing to show is what we know independently of any model: it is available.
            */}
            <span className="meta">{item.reason ?? 'Available now'}</span>
            {/*
              A link to the asset's own page, not a Request button. Requesting needs a unit and a date
              range, which that page already asks for — a one-click "Request" here would promise
              something it cannot finish.
            */}
            <br></br>
            <Link to={ROUTES.asset(item.assetId)}>View {item.name}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
