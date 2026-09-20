// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: staged acceptance-criteria placeholders for screens with no UI yet (SCRUM-128)
// Human Contributions: pending team review

/**
 * Staged acceptance criteria for screens that do not exist yet — the frontend's equivalent of the
 * backend's `describe.skip` blocks in tests/integration/routes/stubs.test.js.
 *
 * Each `it()` here is bodyless on purpose: vitest reports it as todo, so a screen's definition of
 * done is recorded as a test rather than as prose that can drift from what actually gets built.
 * Building a screen means giving its `it()`s real bodies and un-skipping its `describe` block — see
 * code/docs/staged-frontend-tests.md for the full convention.
 */
import { describe, it } from 'vitest';

// only one left. Remove skip and replace with comment when implemented
describe.skip('SCRUM-124: request creation flow from asset detail', () => {
  it('shows a "Request this" affordance only on units whose status is AVAILABLE');
  it(
    'the request form collects neededFrom and neededTo, rejecting neededTo <= neededFrom client-side to match the requestBody schema',
  );
  it("on success, navigates to the new request's detail page or to My requests");
  it(
    'a unit that became unavailable between load and submit surfaces the backend error as a readable message and refreshes the unit state',
  );
  it('the newly created request appears on MyRequestsPage');
});
