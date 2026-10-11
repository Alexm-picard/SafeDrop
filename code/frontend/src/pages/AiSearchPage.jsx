// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: the admin "AI search" page from GET /api/search-telemetry: status line, daily trend, figures, fallback reasons (SCRUM-242, SCRUM-206 AT-4, OD-10)
// Human Contributions: feature choice and placement (its own page, Overview alert only on exceptions) by Amber Rastella; reviewer recorded on the PR
// Notes: Replaces the dashboard card from the first version of SCRUM-242.

/**
 * The AI search page (ORG_ADMIN, `audit:read`): how AI-assisted catalog search and similar-item
 * suggestions are doing for the organisation over the last 30 days (SCRUM-242).
 *
 * It started as a card at the bottom of the Overview, and moved here because it answers a different
 * question from everything else on that page. The Overview is the admin's task list: every figure
 * there asks them to act and links to where they can. This is monitoring, and on most days the answer
 * is "working normally". So the Overview only shows `AiSearchAlert` when `aiSearchStatus` says
 * something needs attention, and this page holds the detail.
 *
 * The page reads top to bottom, from conclusion to evidence:
 *
 * 1. **Status:** one line in plain words, from `aiSearchStatus`, the same function behind the
 *    Overview's alert, so the two can never disagree.
 * 2. **Searches per day:** the trend, stacked by outcome. A 30-day total cannot show "it broke on
 *    Tuesday"; a daily chart can.
 * 3. **At a glance:** the four headline figures.
 * 4. **Why searches fell back:** shown only when some did, in the admin's words rather than the
 *    telemetry's reason codes.
 * 5. **Catalog size:** whether every search could consider the whole catalogue (OD-10).
 */
import { AiSearchTrendChart } from '../components/AiSearchTrendChart';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useSearchTelemetry } from '../hooks/useSearchTelemetry';
import { aiSearchStatus } from '../utils/aiSearchStatus';
import { formatCount, pluralize } from '../utils/format';

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

/** A 0–1 rate as a whole percentage, or an em dash when there is no rate. */
function formatRate(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) ? percent.format(rate) : '—';
}

/** Milliseconds as seconds to one decimal place ("4.8 s"), or an em dash when unknown. */
function formatSeconds(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '—';
}

/** The notice style for each status tone. */
const NOTICE_CLASS = {
  ok: 'notice',
  warn: 'notice notice--warn',
  muted: 'notice notice--muted',
};

/**
 * Why a search fell back, in the admin's words. The keys are the telemetry's reason codes.
 */
const FALLBACK_REASONS = [
  { key: 'unavailable', label: "The AI service didn't respond" },
  { key: 'contract', label: "The AI's answer couldn't be used" },
  { key: 'disabled', label: 'AI search was switched off' },
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
 * Render the page.
 * @returns {JSX.Element}
 */
export function AiSearchPage() {
  const { status, data, error, reload } = useSearchTelemetry();
  return (
    <>
      <header className="page-header">
        <div>
          <h1>AI search</h1>
          <p className="subtitle">
            How AI-assisted catalog search and similar-item suggestions are doing for your
            organization, last 30 days.
          </p>
        </div>
      </header>
      {status === 'loading' ? <LoadingState label="Loading AI search figures…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load AI search figures" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? <Report data={data} /> : null}
    </>
  );
}

/**
 * Everything below the header, for a loaded summary.
 * @param {{ data: object }} props
 * @returns {JSX.Element}
 */
function Report({ data }) {
  const state = aiSearchStatus(data);
  const fellBack = FALLBACK_REASONS.map((r) => ({ ...r, n: data.fallbacks[r.key] })).filter(
    (r) => r.n > 0,
  );
  return (
    <div className="ai-search-page">
      <div className={`${NOTICE_CLASS[state.tone]} ai-status`}>
        <p>
          <strong>{state.title}</strong>
        </p>
        <p>{state.detail}</p>
      </div>
      {data.total > 0 ? (
        <>
          {data.daily ? (
            <section className="card ai-trend-card" aria-labelledby="ai-trend-heading">
              <h2 id="ai-trend-heading">Searches per day</h2>
              <AiSearchTrendChart daily={data.daily} />
            </section>
          ) : null}
          <section aria-labelledby="ai-glance-heading">
            <h2 id="ai-glance-heading">At a glance</h2>
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
          </section>
          {fellBack.length > 0 ? (
            <section aria-labelledby="ai-fallback-heading">
              <h2 id="ai-fallback-heading">Why searches fell back</h2>
              <dl className="ai-reasons" aria-label="Fallback reasons">
                {fellBack.map((r) => (
                  <div key={r.key}>
                    <dt>{r.label}</dt>
                    <dd>{pluralize(r.n, 'search', 'searches')}</dd>
                  </div>
                ))}
              </dl>
              <p className="hint">Members still got plain text matches each time.</p>
            </section>
          ) : null}
          {data.candidateCapHits === 0 ? (
            <p className="hint">
              Catalog size: every search considered your whole catalog. AI search reviews up to{' '}
              {formatCount(data.candidateCap)} items at once.
            </p>
          ) : state.kind !== 'catalog' ? (
            // The status line reports one thing; when it is about failures, the catalog still needs
            // saying here.
            <p className="notice notice--warn">
              Catalog size: {pluralize(data.candidateCapHits, 'search', 'searches')} reached the{' '}
              {formatCount(data.candidateCap)}-item limit, so AI search considered only part of your
              catalog.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
