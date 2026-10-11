// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: the dashboard's "AI search" card from GET /api/search-telemetry (SCRUM-206 AT-4, OD-10)
// Human Contributions: feature choice and scope by Amber Rastella; reviewer recorded on the PR
// Notes: The outcome palette reuses the app's status tokens; checked with the dataviz validator for colour-blind separation.

/**
 * The "AI search" card on the admin dashboard: how the organisation's AI search has been doing over
 * the last 30 days, from `GET /api/search-telemetry` (SCRUM-206).
 *
 * The telemetry existed with no screen to read it on. This puts the three questions it answers in front
 * of the admin who can act on them:
 *
 * - **Is the AI actually being used?** The share of searches the model ranked, and the outcome bar:
 *   every search is exactly one of "ranked by AI" or one of the three fallbacks, so the segments add up
 *   to the total. "Switched off", "unavailable" and "unusable answer" need different fixes, which is
 *   why they are told apart rather than summed.
 * - **Is it fast enough?** The median wait and the 95th percentile, in seconds. The model takes several
 *   seconds, so this is the number a member feels.
 * - **Has the catalogue outgrown it?** A search sends at most `candidateCap` assets to the model. A
 *   search that reaches the cap means part of the catalogue was never considered, which is the
 *   trigger OD-10 sets for semantic retrieval (SCRUM-147).
 *
 * It fetches its own data, like `LoanTimeline`, so a slow or failed telemetry call never holds up the
 * dashboard's own figures. For the same reason its loading and error states are quiet hint lines
 * rather than `role="status"` or `role="alert"`: this is a secondary panel, and the page's main
 * summary owns those announcements.
 *
 * Each colour in the outcome bar is paired with its label and count in the legend below it, so no
 * outcome is identified by colour alone (NFR-12), and the bar itself is hidden from screen readers.
 */
import { useSearchTelemetry } from '../hooks/useSearchTelemetry';
import { formatCount, pluralize } from '../utils/format';

const HEADING_ID = 'ai-search-heading';

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

/** A 0–1 rate as a whole percentage, or an em dash when there is no rate (no searches). */
function formatRate(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) ? percent.format(rate) : '—';
}

/** Milliseconds as seconds to one decimal place ("4.8 s"), or an em dash when unknown. */
function formatSeconds(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '—';
}

/**
 * The four ways a search can end, in the order the bar draws them. The swatch keys are styled in
 * index.css next to the inventory bar's.
 */
const OUTCOMES = [
  { key: 'ai-ranked', label: 'Ranked by AI', count: (d) => d.aiAssisted },
  { key: 'ai-off', label: 'AI switched off', count: (d) => d.fallbacks.disabled },
  { key: 'ai-down', label: 'AI unavailable', count: (d) => d.fallbacks.unavailable },
  { key: 'ai-unusable', label: 'Unusable AI answer', count: (d) => d.fallbacks.contract },
];

/**
 * One headline figure.
 * @param {{ label: string, value: string, detail?: string }} props
 * @returns {JSX.Element}
 */
function Figure({ label, value, detail }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <dd className="stat-detail">{detail}</dd> : null}
    </div>
  );
}

/**
 * Render the card.
 * @returns {JSX.Element}
 */
export function AiSearchHealth() {
  const { status, data, reload } = useSearchTelemetry();

  return (
    <section className="ai-health" aria-labelledby={HEADING_ID}>
      <div className="ai-health-head">
        <h2 id={HEADING_ID}>AI search</h2>
        <p className="hint">Catalog searches and similar-item suggestions, last 30 days.</p>
      </div>
      {status === 'error' ? (
        <div className="ai-health-note ai-health-error">
          <p className="hint">The AI search figures could not be loaded.</p>
          <button type="button" className="secondary" onClick={reload}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <p className="hint ai-health-note">Loading AI search figures…</p>
      ) : data.total === 0 ? (
        <p className="hint ai-health-note">
          No searches in the last 30 days. Figures appear here once members search the catalog.
        </p>
      ) : (
        <Summary data={data} />
      )}
    </section>
  );
}

/**
 * The figures, the outcome bar and the catalogue-size note, for a window with at least one search.
 * @param {{ data: object }} props
 * @returns {JSX.Element}
 */
function Summary({ data }) {
  const outcomes = OUTCOMES.map((o) => ({ ...o, n: o.count(data) }));
  return (
    <>
      <dl className="ai-health-figures" aria-label="AI search summary">
        <Figure label="Searches" value={formatCount(data.total)} />
        <Figure
          label="Ranked by AI"
          value={formatRate(data.aiAssisted / data.total)}
          detail={`${formatCount(data.aiAssisted)} of ${formatCount(data.total)}`}
        />
        <Figure
          label="Typical wait"
          value={formatSeconds(data.latencyMs.p50)}
          detail={`95% within ${formatSeconds(data.latencyMs.p95)}`}
        />
        <Figure
          label="No results"
          value={formatRate(data.zeroResultRate)}
          detail={pluralize(data.zeroResults, 'search', 'searches')}
        />
      </dl>
      <div className="ai-health-outcomes">
        <h3 className="strip-title">How each search was answered</h3>
        <div className="stackbar" aria-hidden="true">
          {outcomes
            .filter((o) => o.n > 0)
            .map((o) => (
              <span
                key={o.key}
                data-swatch={o.key}
                style={{ flexGrow: o.n }}
                title={`${o.label}: ${formatCount(o.n)}`}
              />
            ))}
        </div>
        <dl className="legend" aria-label="Search outcomes">
          {outcomes.map((o) => (
            <div className="stat" key={o.key}>
              <dt>
                <span className="swatch" data-swatch={o.key} aria-hidden="true" />
                {o.label}
              </dt>
              <dd>{formatCount(o.n)}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">
          Whenever the AI could not rank, members still got plain text matches.
        </p>
      </div>
      {data.candidateCapHits > 0 ? (
        <p className="notice notice--warn ai-health-cap">
          {pluralize(data.candidateCapHits, 'search', 'searches')} reached the{' '}
          {formatCount(data.candidateCap)}-item limit, so the AI considered only part of your
          catalog.
        </p>
      ) : (
        <p className="hint ai-health-note">
          Every search considered your whole catalog (the AI reviews up to{' '}
          {formatCount(data.candidateCap)} items at once).
        </p>
      )}
    </>
  );
}
