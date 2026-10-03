// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~85% (test-first pairing session; written and run red before the component existed)
// AI-Assisted Areas: tests for the "Similar items available now" section (SCRUM-151, subtask SCRUM-188)
// Human Contributions: acceptance criteria and the red/green decisions by Mateus Silva
// Notes: The page-level condition (shown only when nothing is available) is covered in AssetDetailPage.test.jsx.

/**
 * Tests for the "Similar items available now" section (SCRUM-151).
 *
 * The section a member sees instead of a dead end. Its job is narrow: show a handful of things they
 * could borrow right now, each as a link they can act on.
 *
 * **It must never be the loudest thing on the page.** It is an extra offered at a moment of
 * frustration, so when there is nothing to show — no recommendations, or the call failed — it renders
 * nothing at all rather than an empty heading or a red panel. A failed suggestion is not the
 * member's problem to read about (AT-3: no error text from upstream).
 */
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { SimilarItems } from '../../../src/components/SimilarItems';
import { assets, errorResponse, memberUser, similarItems } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

/** The R6 in the fixtures: one HELD unit, so nothing is available — the dead end this answers. */
const stuckOn = assets[1];

const renderSection = (props) =>
  renderWithAuth(<SimilarItems assetId={stuckOn.id} enabled {...props} />, { user: memberUser });

describe('SimilarItems (SCRUM-151)', () => {
  it('shows a loading state, then each recommendation with its reason and a link', async () => {
    renderSection();

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    const section = await screen.findByRole('region', { name: 'Similar items available now' });
    const [recommended] = similarItems.alternatives;
    expect(within(section).getByText(recommended.name)).toBeInTheDocument();
    expect(within(section).getByText(recommended.reason)).toBeInTheDocument();
    // A link, not a button: the member goes to that asset's page, where requesting already lives.
    expect(within(section).getByRole('link', { name: `View ${recommended.name}` })).toHaveAttribute(
      'href',
      `/assets/${recommended.assetId}`,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('makes no request at all when the asset has something available', async () => {
    // The page passes `enabled={false}` when a unit is free. Asserted here as well as on the page,
    // because this is the component's own contract: given nothing to ask, it asks nothing.
    let calls = 0;
    server.use(
      http.get('*/api/assets/:id/alternatives', () => {
        calls += 1;
        return HttpResponse.json(similarItems);
      }),
    );

    renderSection({ enabled: false });

    expect(calls).toBe(0);
    expect(
      screen.queryByRole('region', { name: 'Similar items available now' }),
    ).not.toBeInTheDocument();
  });

  it('renders the fallback shape, with a factual line in place of a model’s reason', async () => {
    // AT-3. With no model there is no explanation, so the backend sends `reason: null` rather than
    // inventing one. The section says what it knows instead: the item is available.
    server.use(
      http.get('*/api/assets/:id/alternatives', () =>
        HttpResponse.json({
          alternatives: [
            {
              assetId: '6aab2a45c6e457e01ac0973b',
              name: 'Nikon Z6',
              category: 'camera',
              description: 'Full-frame mirrorless',
              reason: null,
            },
          ],
          aiAssisted: false,
        }),
      ),
    );

    renderSection();

    const section = await screen.findByRole('region', { name: 'Similar items available now' });
    expect(within(section).getByText('Nikon Z6')).toBeInTheDocument();
    expect(within(section).getByText('Available now')).toBeInTheDocument();
  });

  it('renders nothing when there is nothing to suggest', async () => {
    server.use(
      http.get('*/api/assets/:id/alternatives', () =>
        HttpResponse.json({ alternatives: [], aiAssisted: false }),
      ),
    );

    renderSection();

    // Not an empty heading: a section with no content is worse than no section.
    await expect(
      screen.findByRole('region', { name: 'Similar items available now' }, { timeout: 100 }),
    ).rejects.toThrow();
  });

  it('stays quiet when the call fails, rather than showing an error', async () => {
    server.use(
      http.get('*/api/assets/:id/alternatives', () =>
        errorResponse(503, 'SERVICE_UNAVAILABLE', 'Recommendations are unavailable'),
      ),
    );

    renderSection();

    await expect(
      screen.findByRole('region', { name: 'Similar items available now' }, { timeout: 100 }),
    ).rejects.toThrow();
    // The member came here to borrow a camera. A failed extra must not read as the page being broken.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });
});
