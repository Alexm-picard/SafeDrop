// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-150 ticket)
// AI-Assisted Areas: the Restricted badge on a restricted asset, including one whose groups were all deleted (SCRUM-203)
// Human Contributions: reviewed and approved by Mateus Silva (PR #60, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Verified by tests/unit/components/AssetDetailPage.test.jsx and CatalogPage.test.jsx. Reviewed before merge; see Human Contributions.

/**
 * Restricted equipment (SCRUM-150, AT-4): the badge on a restricted asset. The sentence that explains
 * it is `restrictionNote()` in utils/format.js.
 *
 * Restricted assets stay visible rather than hidden (the ticket's design note), so a member who
 * cannot borrow one learns which group they would need to join instead of wondering where it went.
 * All of this is presentation: the API enforces eligibility on submit and on approval.
 */
import { restrictionNote } from '../utils/format';

/**
 * The badge. Renders nothing for an unrestricted asset, so callers can drop it in unconditionally.
 *
 * Shown whenever the API says the asset is `restricted` — including when every group it listed has
 * been deleted and there are no names left (SCRUM-203). A response without the flag falls back to
 * "has named groups".
 *
 * The group names ride on `title` for a quick hover on the catalogue; the detail page also spells them
 * out in text, because a tooltip is not reachable by keyboard or touch.
 * @param {{ allowedGroups?: { id: string, name: string }[], restricted?: boolean }} props
 * @returns {JSX.Element|null}
 */
export function RestrictedBadge({ allowedGroups = [], restricted }) {
  if (!(restricted ?? allowedGroups.length > 0)) {
    return null;
  }
  return (
    <span className="restricted-badge" title={restrictionNote(allowedGroups, { restricted: true })}>
      Restricted
    </span>
  );
}
