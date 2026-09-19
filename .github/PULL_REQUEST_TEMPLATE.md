<!--
Title: the Jira key and what changed, e.g. "SCRUM-133: make GET /health verify the database connection".
Start it with [AI] if AI tools wrote part of the change.

Tick each box once it is true. If an item does not apply to this PR, leave it unticked and write
N/A and the reason after it. The checklist is the Definition of Done agreed at the Iteration 1
Kickoff (section 5).
-->

## Ticket

https://bu-team-x3gl1rkg.atlassian.net/browse/SCRUM-

## Summary

<!-- What changed and why. Say what you ran by hand for the manual acceptance check. -->

## Definition of Done

### Before merge

- [ ] Approved by a second team member
- [ ] Unit tests written for the new behaviour and passing; line coverage has not decreased
- [ ] CodeQL and npm audit report no new high or critical findings
- [ ] Access control verified: a cross-tenant attempt AND a wrong-role attempt are both covered by tests
- [ ] State-changing actions write an audit entry
- [ ] The story's acceptance tests pass when executed manually
- [ ] If this ticket's acceptance criteria are staged in a `describe.skip` block (e.g. `code/backend/tests/integration/routes/stubs.test.js`): the block is un-skipped or moved to the feature's own test file, every `it()` in it has a body, and the route is out of the 501 stub table

### After merge

<!-- Staging deploys only from main, so these come after the merge. Come back and tick them. -->

- [ ] Deployed to staging and smoke-tested there, not only locally (URLs in the README's Staging section)
- [ ] Jira issue moved to Done with ACTUAL hours logged against the estimate
