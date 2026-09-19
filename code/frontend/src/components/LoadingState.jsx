// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: accessible loading indicator (role=status, aria-live)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The shared loading indicator.
 */

/**
 * Render a polite loading message.
 *
 * `role="status"` with `aria-live="polite"` announces it to a screen reader once the current utterance
 * finishes, rather than interrupting — the right register for "still working", as opposed to the
 * assertive alert used for errors.
 * @param {{ label?: string }} props
 * @returns {JSX.Element}
 */
export function LoadingState({ label = 'Loading…' }) {
  return (
    <div role="status" aria-live="polite" className="state state--loading">
      {label}
    </div>
  );
}
