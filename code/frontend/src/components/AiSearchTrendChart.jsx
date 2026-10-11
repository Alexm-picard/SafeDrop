// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: the AI search page's daily chart, searches stacked by outcome (SCRUM-242)
// Human Contributions: feature choice and placement by Amber Rastella; reviewer recorded on the PR
// Notes: Same construction as CheckoutActivityChart; the two colours were checked with the dataviz palette validator.

/**
 * Searches per day, stacked by outcome: ranked by AI at the base, fell back to text matching on top
 * (SCRUM-242).
 *
 * Built like `CheckoutActivityChart`, so the two charts in the admin area read the same way: a
 * hand-drawn SVG, a full-height hover target per day, only the busiest day labelled, and the numbers
 * repeated in a visually hidden table.
 *
 * What is different, and why:
 *
 * - **Two series, so a legend.** It sits above the plot, and each entry is a swatch beside its words,
 *   so neither outcome is told apart by colour alone (NFR-12). The colours are the app's ok green and
 *   the amber the outcome bar already used for fallbacks; together they pass the palette validator's
 *   colour-blind checks. The amber is below 3:1 against white, which the legend, the per-day hover text
 *   and the table make up for.
 * - **Ranked sits on the baseline.** It is the normal outcome, so a healthy month is a green chart,
 *   and fallbacks show as amber caps that are easy to spot on top.
 * - **A surface-coloured gap between the two segments**, so a short cap does not merge into the bar
 *   below it. Only the top segment of a day gets rounded corners.
 */
import { formatCount, formatDay } from '../utils/format';

const WIDTH = 600;
const HEIGHT = 170;
const PAD_TOP = 18;
const PAD_BOTTOM = 22;
const BAR_SHARE = 0.6;
const CORNER = 2;
const GAP = 2;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;
const BASELINE = PAD_TOP + PLOT_HEIGHT;

/**
 * A bar segment from `bottom` up `height` units, rounded on top only when it is the day's top.
 * @returns {string} an SVG path
 */
function segmentPath(x, width, bottom, height, rounded) {
  const top = bottom - height;
  const r = rounded ? Math.min(CORNER, height / 2, width / 2) : 0;
  return [
    `M${x} ${bottom}`,
    `V${top + r}`,
    `q0 ${-r} ${r} ${-r}`,
    `h${width - 2 * r}`,
    `q${r} 0 ${r} ${r}`,
    `V${bottom}`,
    'Z',
  ].join(' ');
}

/** "3 ranked by AI, 1 fell back", the per-day text used for hover and the description. */
function dayText(day) {
  return `${formatCount(day.aiAssisted)} ranked by AI, ${formatCount(day.fallback)} fell back`;
}

/**
 * Render the series.
 * @param {{ daily: Array<{ date: string, aiAssisted: number, fallback: number }> }} props
 * @returns {JSX.Element}
 */
export function AiSearchTrendChart({ daily = [] }) {
  if (daily.length === 0) {
    return <p className="hint">No searches to chart yet.</p>;
  }
  const totals = daily.map((day) => day.aiAssisted + day.fallback);
  const peak = Math.max(...totals);
  const scale = Math.max(peak, 1);
  const peakIndex = totals.indexOf(peak);
  const slot = WIDTH / daily.length;
  const barWidth = Math.max(slot * BAR_SHARE, 1);
  const ranked = daily.reduce((sum, day) => sum + day.aiAssisted, 0);
  const fellBack = daily.reduce((sum, day) => sum + day.fallback, 0);
  const description =
    peak === 0
      ? `Stacked bar chart of searches per day over ${daily.length} days. No searches in this period.`
      : `Stacked bar chart of searches per day over ${daily.length} days: ${formatCount(ranked)} ranked by AI and ${formatCount(fellBack)} fell back to text matching. Busiest day ${formatDay(daily[peakIndex].date)}, with ${formatCount(peak)} searches.`;
  const axisLabels = [
    ...new Map([
      [0, 'start'],
      [Math.floor((daily.length - 1) / 2), 'middle'],
      [daily.length - 1, 'end'],
    ]),
  ].map(([index, anchor]) => ({ index, anchor, day: daily[index] }));

  return (
    <figure className="chart ai-trend">
      <figcaption>
        {formatDay(daily[0].date)} – {formatDay(daily.at(-1).date)}, by outcome
      </figcaption>
      <ul className="chart-legend" aria-hidden="true">
        <li>
          <span className="swatch" data-swatch="ai-ranked" />
          Ranked by AI
        </li>
        <li>
          <span className="swatch" data-swatch="ai-fell-back" />
          Fell back to text matching
        </li>
      </ul>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={description}
      >
        {daily.map((day, index) => {
          const x = index * slot + (slot - barWidth) / 2;
          const rankedHeight = (day.aiAssisted / scale) * PLOT_HEIGHT;
          const fallbackHeight = (day.fallback / scale) * PLOT_HEIGHT;
          // The gap comes out of the upper segment, so the day's total height stays true to scale.
          const gap =
            day.aiAssisted > 0 && day.fallback > 0 ? Math.min(GAP, fallbackHeight / 2) : 0;
          return (
            <g key={day.date}>
              <rect
                className="chart-hit"
                x={index * slot}
                y={PAD_TOP}
                width={slot}
                height={PLOT_HEIGHT}
              >
                <title>{`${formatDay(day.date)}: ${dayText(day)}`}</title>
              </rect>
              {day.aiAssisted > 0 ? (
                <path
                  className="chart-bar"
                  data-swatch="ai-ranked"
                  d={segmentPath(x, barWidth, BASELINE, rankedHeight, day.fallback === 0)}
                />
              ) : null}
              {day.fallback > 0 ? (
                <path
                  className="chart-bar"
                  data-swatch="ai-fell-back"
                  d={segmentPath(
                    x,
                    barWidth,
                    BASELINE - rankedHeight - gap,
                    fallbackHeight - gap,
                    true,
                  )}
                />
              ) : null}
            </g>
          );
        })}
        {peak > 0 ? (
          <text
            className="chart-peak"
            x={peakIndex * slot + slot / 2}
            y={BASELINE - (peak / scale) * PLOT_HEIGHT - 6}
            textAnchor="middle"
          >
            {formatCount(peak)}
          </text>
        ) : null}
        <line className="chart-axis" x1="0" y1={BASELINE} x2={WIDTH} y2={BASELINE} />
        {axisLabels.map(({ index, day, anchor }) => (
          <text
            key={day.date}
            className="chart-axis-label"
            x={index * slot + slot / 2}
            y={HEIGHT - 6}
            textAnchor={anchor}
          >
            {formatDay(day.date)}
          </text>
        ))}
      </svg>
      <div className="visually-hidden">
        <table>
          <caption>Searches per day by outcome</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Ranked by AI</th>
              <th scope="col">Fell back</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((day) => (
              <tr key={day.date}>
                <th scope="row">{formatDay(day.date)}</th>
                <td>{formatCount(day.aiAssisted)}</td>
                <td>{formatCount(day.fallback)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
