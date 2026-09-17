// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: accessible loading indicator (role=status, aria-live)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
export function LoadingState({ label = 'Loading…' }) {
  return (
    <div role="status" aria-live="polite" className="state state--loading">
      {label}
    </div>
  );
}
