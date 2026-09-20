// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: activity chart tests: one bar per active day, geometry inside the canvas, table view, empty series (SCRUM-102)
// Human Contributions:
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Tests for the dashboard's checkout activity chart.
 *
 * A hand-drawn SVG has no layout engine to catch it when the arithmetic is wrong, so these tests
 * check the geometry as well as the content: every bar sits inside the canvas, on the baseline, in
 * date order, and the tallest bar is the busiest day. That is the part a reviewer cannot see by
 * reading the JSX.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckoutActivityChart } from '../../../src/components/CheckoutActivityChart';

const WIDTH = 600;
const HEIGHT = 160;
const BASELINE = 138; // PAD_TOP + PLOT_HEIGHT

/** `days` consecutive days from 2026-08-22, taking their counts from `counts`. */
const series = (counts) =>
  counts.map((checkouts, index) => ({
    date: new Date(Date.UTC(2026, 7, 22 + index)).toISOString().slice(0, 10),
    checkouts,
  }));

/**
 * Every bar as `{ x, shoulder, bottom }`, read back out of the path data.
 *
 * `shoulder` is where the rounded top starts — the path's first vertical stop, which sits one corner
 * radius (2) below the bar's actual top. Reading the path is the only way to check the arithmetic:
 * jsdom does no SVG layout, so there is no computed geometry to ask for.
 */
const bars = (container) =>
  [...container.querySelectorAll('.chart-bar')].map((path) => {
    const d = path.getAttribute('d');
    const [x, bottom] = d
      .match(/^M([\d.]+) ([\d.]+)/)
      .slice(1)
      .map(Number);
    const shoulder = Number(d.match(/V([\d.]+) q/)[1]);
    return { x, shoulder, bottom };
  });

describe('CheckoutActivityChart', () => {
  it('draws one bar per day that had a checkout, and none for the quiet days', () => {
    const { container } = render(<CheckoutActivityChart activity={series([0, 3, 0, 1])} />);
    expect(bars(container)).toHaveLength(2);
    expect(container.querySelectorAll('.chart-hit')).toHaveLength(4);
  });

  it('keeps every bar inside the canvas, on the baseline, in date order', () => {
    const { container } = render(
      <CheckoutActivityChart activity={series(Array.from({ length: 30 }, (_, i) => i % 7))} />,
    );
    const drawn = bars(container);
    expect(drawn.length).toBeGreaterThan(0);
    for (const bar of drawn) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x).toBeLessThan(WIDTH);
      expect(bar.bottom).toBeCloseTo(BASELINE, 5);
      expect(bar.shoulder).toBeGreaterThanOrEqual(0);
      expect(bar.shoulder).toBeLessThan(BASELINE);
    }
    const xs = drawn.map((bar) => bar.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  });

  it('scales the busiest day to the full plot height and labels it', () => {
    const { container } = render(<CheckoutActivityChart activity={series([1, 4, 2])} />);
    const tallest = bars(container).reduce((a, b) => (a.shoulder < b.shoulder ? a : b));
    // PAD_TOP (18) plus the corner radius (2): the busiest day fills the whole plot area.
    expect(tallest.shoulder).toBeCloseTo(20, 5);
    expect(container.querySelector('.chart-peak')).toHaveTextContent('4');
  });

  it('describes itself, and repeats every number in a table', () => {
    render(<CheckoutActivityChart activity={series([0, 2, 5])} />);
    const chart = screen.getByRole('img', { name: /bar chart of checkouts per day/i });
    expect(chart).toHaveAccessibleName(/7 in total/i);
    expect(chart).toHaveAccessibleName(/busiest day of 5 on Aug 24/i);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Aug 23').nextElementSibling).toHaveTextContent('2');
  });

  it('renders a flat, unlabelled baseline when nothing happened', () => {
    const { container } = render(<CheckoutActivityChart activity={series([0, 0, 0])} />);
    expect(bars(container)).toHaveLength(0);
    expect(container.querySelector('.chart-peak')).toBeNull();
    expect(screen.getByRole('img', { name: /no checkouts in this period/i })).toBeInTheDocument();
  });

  it('says so instead of drawing an axis with nothing on it', () => {
    render(<CheckoutActivityChart activity={[]} />);
    expect(screen.getByText(/no checkout activity/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('labels the ends and the middle of the window exactly once each', () => {
    const { container } = render(<CheckoutActivityChart activity={series([1, 2, 3, 4, 5])} />);
    const labels = [...container.querySelectorAll('.chart-axis-label')];
    expect(labels.map((label) => label.textContent)).toEqual(['Aug 22', 'Aug 24', 'Aug 26']);
    expect(labels.map((label) => label.getAttribute('text-anchor'))).toEqual([
      'start',
      'middle',
      'end',
    ]);
  });
});
