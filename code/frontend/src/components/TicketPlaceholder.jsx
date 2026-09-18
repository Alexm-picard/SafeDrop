// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: placeholder block naming the Sprint ticket that owns a screen
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The stand-in for a screen whose ticket has not been delivered yet.
 *
 * Iteration 1 ships the whole navigable shell — routes, guards, layout — with the unfinished screens
 * showing this instead of their content. Naming the owning ticket makes an incomplete feature legible
 * as planned work rather than as a bug, and matches the ticket the API returns in its 501 responses.
 */

/**
 * Render the placeholder for an unimplemented screen.
 * @param {{ ticket: string, children?: React.ReactNode }} props ticket id, and optional extra explanation
 * @returns {JSX.Element}
 */
export function TicketPlaceholder({ ticket, children }) {
  return (
    <section className="placeholder" aria-label="Not implemented yet">
      <p>
        This screen is owned by <span className="ticket">{ticket}</span>.
      </p>
      {children ? <p>{children}</p> : null}
    </section>
  );
}
