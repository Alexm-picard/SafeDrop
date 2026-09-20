// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: 30-day checkout activity bar chart, inline SVG with a table view and per-day tooltips (SCRUM-102)
// Human Contributions:
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; chart conventions from the team's data-viz guidance.

/**
 * The dashboard's checkout activity chart: one bar per day for the last 30 days (SCRUM-102).
 *
 * Hand-drawn SVG rather than a charting library. The chart is one series of thirty small integers,
 * which is a few dozen lines of geometry here against a dependency of its own — and the SPPP asks
 * that added dependencies earn their place.
 *
 * Three decisions make it readable rather than decorative:
 *
 * **One hue, no legend.** A single series needs no colour key; the figure's caption names what the
 * bars are. The bars take the interface's accent colour from the stylesheet, and every number stays
 * in text colour, so identity never rests on colour alone (NFR-12).
 *
 * **Only the busiest day is labelled.** A value above all thirty bars is noise; the peak is the one
 * an admin looks for, and every other value is available on hover and in the table.
 *
 * **The table is the chart.** The same numbers are rendered as a real `<table>`, visible to screen
 * readers and hidden from sight, so the figure is not information that only sighted users can read.
 */
import { formatCount, formatDay } from '../utils/format';

// A 600 × 160 canvas scaled to the container's width. Each day gets an equal slot and the bar fills
// 60% of it, which at the usual thirty days is a 12-wide bar in a 20-wide slot — the gap either side
// is what keeps adjacent bars from reading as one block. Deriving both from the number of days means
// a shorter or longer window stays proportioned instead of leaving hairlines in wide slots.
const WIDTH = 600;
const HEIGHT = 160;
const PAD_TOP = 18; // headroom for the peak label
const PAD_BOTTOM = 22; // the date axis
const BAR_SHARE = 0.6;
const CORNER = 2;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;

/**
 * A bar with its top corners rounded and its base square on the axis.
 *
 * `rect` with an `rx` would round the bottom too and lift the bar off the baseline; the radius is
 * also capped at half the height so a one- or two-pixel bar keeps its shape.
 * @param {number} x left edge
 * @param {number} width bar width in user units
 * @param {number} height bar height in user units
 * @returns {string} an SVG path
 */
function barPath(x, width, height) {
  const baseline = PAD_TOP + PLOT_HEIGHT;
  const top = baseline - height;
  const r = Math.min(CORNER, height / 2, width / 2);
  return [
    `M${x} ${baseline}`,
    `V${top + r}`,
    `q0 ${-r} ${r} ${-r}`,
    `h${width - 2 * r}`,
    `q${r} 0 ${r} ${r}`,
    `V${baseline}`,
    'Z',
  ].join(' ');
}

/**
 * Render the activity series.
 *
 * `activity` is the API's array of `{ date, checkouts }`, already zero-filled by the server — the
 * component draws exactly what it is given and never infers a missing day.
 * @param {{ activity: Array<{ date: string, checkouts: number }> }} props
 * @returns {JSX.Element}
 */
export function CheckoutActivityChart({ activity = [] }) {
  if (activity.length === 0) {
    return <p className="hint">No checkout activity to show yet.</p>;
  }
  const total = activity.reduce((sum, day) => sum + day.checkouts, 0);
  const peak = Math.max(...activity.map((day) => day.checkouts));
  // An all-zero series still gets a full-height scale of 1, so the empty chart reads as a flat
  // baseline rather than as thirty bars of unknown size.
  const scale = Math.max(peak, 1);
  const peakIndex = activity.findIndex((day) => day.checkouts === peak);
  const slot = WIDTH / activity.length;
  const barWidth = Math.max(slot * BAR_SHARE, 1);
  const first = activity[0];
  const last = activity.at(-1);
  // Three labels, not thirty: the two ends and the midpoint are enough to place a bar in the month,
  // and a label per day would collide at this width. Keyed by index through a Map, so a very short
  // window prints each date once instead of three times.
  // What the chart says in words, for anyone who cannot see it: the shape of the series in one
  // sentence, rather than a reading of all thirty numbers — those are in the table below.
  const description =
    total === 0
      ? `Bar chart of checkouts per day over the last ${activity.length} days. No checkouts in this period.`
      : `Bar chart of checkouts per day over the last ${activity.length} days. ${formatCount(total)} in total, with a busiest day of ${formatCount(peak)} on ${formatDay(activity[peakIndex].date)}.`;
  const axisLabels = [
    ...new Map([
      [0, 'start'],
      [Math.floor((activity.length - 1) / 2), 'middle'],
      [activity.length - 1, 'end'],
    ]),
  ].map(([index, anchor]) => ({ index, anchor, day: activity[index] }));
  return (
    <figure className="chart">
      <figcaption>
        Checkouts per day, {formatDay(first.date)} – {formatDay(last.date)}
      </figcaption>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={description}
      >
        {activity.map((day, index) => {
          const height = (day.checkouts / scale) * PLOT_HEIGHT;
          return (
            <g key={day.date}>
              {/* A full-height, invisible column: the hover target is the whole day, not the bar,
                  which on a quiet day is only a pixel or two tall. */}
              <rect
                className="chart-hit"
                x={index * slot}
                y={PAD_TOP}
                width={slot}
                height={PLOT_HEIGHT}
              >
                <title>{`${formatDay(day.date)}: ${formatCount(day.checkouts)}`}</title>
              </rect>
              {day.checkouts > 0 ? (
                <path
                  className="chart-bar"
                  d={barPath(index * slot + (slot - barWidth) / 2, barWidth, height)}
                />
              ) : null}
            </g>
          );
        })}
        {peak > 0 ? (
          <text
            className="chart-peak"
            x={peakIndex * slot + slot / 2}
            y={PAD_TOP + PLOT_HEIGHT - (peak / scale) * PLOT_HEIGHT - 6}
            textAnchor="middle"
          >
            {formatCount(peak)}
          </text>
        ) : null}
        <line
          className="chart-axis"
          x1="0"
          y1={PAD_TOP + PLOT_HEIGHT}
          x2={WIDTH}
          y2={PAD_TOP + PLOT_HEIGHT}
        />
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
          <caption>Checkouts per day over the last {activity.length} days</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Checkouts</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((day) => (
              <tr key={day.date}>
                <th scope="row">{formatDay(day.date)}</th>
                <td>{formatCount(day.checkouts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
