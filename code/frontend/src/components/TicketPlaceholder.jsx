// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: placeholder block naming the Sprint ticket that owns a screen
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
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
