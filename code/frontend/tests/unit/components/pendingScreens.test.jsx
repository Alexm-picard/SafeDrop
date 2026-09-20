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
 * code/docs/staged-acceptance-tests.md for the full convention.
 */
import { describe, it } from 'vitest';

// SCRUM-124 (request creation flow from asset detail) shipped; its real tests are in
// RequestCreation.test.jsx. It was the last staged block, so nothing is staged right now.
//
// The single todo below exists only to keep this file loadable: vitest fails a spec file that
// contains no tests at all ("No test suite found in file"), and deleting the file would move the
// staging location the convention doc points at. Replace it with the next unbuilt ticket's
// `describe.skip` block.
describe('staged screens', () => {
  it.todo('nothing is staged: add the next unbuilt ticket’s describe.skip block here');
});
