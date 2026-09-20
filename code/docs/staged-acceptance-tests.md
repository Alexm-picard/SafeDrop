# Staging acceptance criteria as tests

A ticket with no implementation yet is staged as a test: a `describe.skip` block full of bodyless
`it('...')` calls, one per acceptance criterion, grouped by ticket. Vitest reports each one as todo,
so a story's definition of done lives in the suite itself — a place that gets run and reviewed —
instead of in prose that can drift from what actually ships.

## The convention

For any ticket with acceptance criteria but no implementation yet:

1. Add one bodyless `it('...')` per behaviour the ticket's acceptance criteria describe, grouped
   under a `describe.skip('SCRUM-xxx: <short name>', () => { ... })` block.
2. Word each `it()` as a direct restatement of one AC bullet — not a summary, not an implementation
   detail invented here. If the AC changes, the `it()` text should change with it.
3. A ticket's bullet that says "tests cover X" is not staged. It describes test coverage, not
   behaviour, so there's nothing for an `it()` here to restate.
4. When the ticket is implemented: write the real, passing test in the feature's own dedicated test file, then delete the `describe.skip` block from the staging file entirely, leaving a one-line comment pointing at the real file (starting now)

---

### Backend: `code/backend/tests/integration/routes/stubs.test.js`

### Frontend: `code/frontend/tests/unit/components/pendingScreens.test.jsx`



