// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100%
// AI-Assisted Areas: Previous / Page x of y / Next control for paged panels (UI rework)
// Human Contributions: reviewed and approved by Alex Picard (PR #62, 2026-10-04); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL

/**
 * Previous / "Page 2 of 3" / Next. Renders nothing when everything fits on one page, so a short list
 * carries no controls it cannot use.
 *
 * Rendered as a panel footer: in a panel stretched to match the column beside it, the footer sits at
 * the bottom edge rather than directly under the last row.
 * @param {{ page: number, pageCount: number, onChange: (page: number) => void, label: string }} props
 *   `label` names the landmark ("Units pages"), since a page may hold several of these.
 * @returns {JSX.Element|null}
 */
export function Pagination({ page, pageCount, onChange, label }) {
  if (pageCount <= 1) {
    return null;
  }
  return (
    <nav className="pagination panel-footer" aria-label={label}>
      <button
        type="button"
        className="secondary small"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        className="secondary small"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
