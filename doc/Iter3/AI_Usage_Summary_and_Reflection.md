# SafeDrop: AI Usage Summary and Team Reflection

CS673 Team 3 · Iteration 3 · SCRUM-227

## Part 1: AI usage summary

### Tools

| Tool                                                     | Used for                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code** (Anthropic), in VS Code and the terminal | Writing and changing code, writing tests, reviewing diffs, drafting documentation and decision records, diagnosing failures from logs, and Jira and GitHub housekeeping |
| **Microsoft Foundry** (`asset-search` agent, gpt-5-mini) | A product feature, not a development tool: it ranks catalogue search results and similar-item suggestions at run time                                                   |

Claude Code is the only development tool named in any file header. Every one of the 274 headers that records a tool names it.

### How much of the work was AI-assisted

We measure this two ways, and they answer different questions.

| Measure                                             | Value                                                     | What it counts                                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AI contribution recorded in file headers            | **mean 92%** (median 90%, range 60–100%) across 274 files | The share of each file's content first produced by the AI, as recorded by the author and confirmed by the reviewer (SCRUM-216) |
| Commits carrying a `Co-Authored-By: Claude` trailer | **74 of 194** (38%)                                       | Only commits where the trailer was kept. It was not used consistently, so this understates AI involvement                      |

By area, the header figures are close together: backend source 91%, backend tests 92%, frontend source 93%, frontend tests 93%, CI workflows 90%. The honest summary is that **most code, tests and documentation were first drafted by AI, and the team's work was specifying, reviewing, testing and deciding.** The commit figure is the lower bound of how often the AI was involved in a change.

### What it was used for

- **Code:** the Express API (layers, tenant scoping, the checkout state machine, audit log), the React SPA, and the Foundry integration.
- **Tests:** written test-first wherever practical, each run failing before the code that satisfies it. The suites now hold about 1,190 backend and 450 frontend tests, behind an 80% line-coverage gate.
- **Documentation:** the SDD drafts, decision records (OD-9 search telemetry, OD-10 candidate retrieval), the STD case tables, READMEs, and the AI prompt itself (`services/ai/prompts/asset-search.md`).
- **Design:** proposals and comparisons the team then decided on. Examples are where the AI agent may get data (OD-10: never the database), and how search telemetry avoids storing member input (OD-9).
- **Operations:** reading staging logs to diagnose failures, and the CI, backup, DAST and seeding workflows.

### How AI output was reviewed

- **A second team member reviews every pull request.** Of 82 merged PRs, 79 were merged by someone other than the author, 63 carry a formal GitHub approval, and none was self-merged without one.
- **Automated gates on every PR:** lint, format, tests with the coverage floor, `npm audit`, both Docker builds, and CodeQL. OWASP ZAP scans staging weekly and on each release.
- **Every AI-assisted file names its human reviewer** and what they checked, in its header (SCRUM-216).
- **User-facing changes were run in the real app before pushing** where we could, and screenshotted or demonstrated, not only unit-tested.
- **Security rules sit in tests, so a reviewer doesn't have to spot them by eye:** tenant-isolation tests on every resource, and tests asserting the AI layer never logs a prompt, a reply or a key.

## Part 2: Team reflection

### What worked

**Test-first with an AI writing both halves.** Asking for the failing test before the code kept the AI honest about what a change was for. A test written after the fact tends to restate what the code does. A test written first, and seen failing, states what was asked. Where we did this (most of the backend, the AI search features), defects found later were mostly in behaviour the tests could not see, not in the code they covered.

**Decision records with evidence.** OD-9 and OD-10 put a question, the options, a measurement and a decision in one place. OD-10 is the clearest case. Instead of building vector search because the plan said so, we measured the live model first. It already matched by meaning within its 100-item candidate set, so we deferred the work, with a stated trigger for when to revisit it.

**Keeping security rules out of the AI's discretion.** The agent is never given database access. Candidates are chosen by tenant-scoped queries, and any asset id the model returns that was not offered is dropped. Those choices meant a model mistake could produce a wrong answer, but not a data leak.

### What did not

**Mocked tests gave false confidence about AI behaviour.** Every test of the search pipeline mocks Foundry, which is right for speed and repeatability. But it meant the suite could not see whether the _model's_ answers made sense, and two real defects passed every test. We only found them by using the feature with a live model and realistic data (below).

**Bookkeeping lagged behind the work.** At the end of Iteration 2, 84 of 217 headers still said "pending team review", which was the largest single deduction in our AI Usage score. Headers had also been removed by mistake from 11 files and had to be restored (SCRUM-216).

**Large AI-written changes are hard to review well.** Not every PR got a formal approval (63 of 82), and the ones that did were sometimes approved within minutes. Twice, a PR was merged before its author had finished pushing to it (#78, #81), and the later commits never reached `main` until follow-up PRs were opened.

### Where the AI was wrong, and how we caught it

| What the AI produced                                                                                                                | How it was caught                                                      | Fix                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Similar items recommended a camera and a projector for a laptop "because both names contain B". All tests passed.                   | Using the feature against the live model                               | SCRUM-184: same-category candidates first, and a same-category fallback            |
| AI search sent the model the first 100 items _alphabetically_, so "draw digital art" never saw the Wacom tablets. All tests passed. | Testing with a realistic 125-item catalogue                            | SCRUM-243: candidates ranked by matching words                                     |
| After a local test of six concurrent searches succeeded, the AI concluded the staging failures were "not a rate limit".             | The staging logs: every failure was a 429 rate limit                   | SCRUM-244: retry as Foundry asks; we raised the token limit                        |
| An estimate of "about 20,000 tokens per search"                                                                                     | Measuring a real request (about 9,300)                                 | Corrected in code and docs                                                         |
| OD-10 named a telemetry figure as its trigger that no screen actually showed                                                        | The AI's own review while building the UI that would show it           | Added to the API and the AI search page                                            |
| A first design put AI monitoring as a card on the admin Overview                                                                    | Human visual review: it read as "random and static" on a page of tasks | Moved to its own page, with an Overview notice only when something needs attention |
| An earlier instruction to remove AI-usage headers stayed in the AI's saved memory after the team made headers a deliverable         | Amber noticed the conflict                                             | Instruction reversed and the memory corrected                                      |

The pattern is consistent: **the AI was most often wrong where the truth lived outside the code**, in a model's actual behaviour, in production logs, or in how a screen felt to use. Unit tests did not catch any of these; running the system did.

### What we would do differently

- **Make "run it live with realistic data" part of done for anything involving the model**, and seed a realistic catalogue from the first iteration, not the last.
- **Measure before estimating.** Token counts, latency and rate limits took one request each to measure, and each estimate we made without measuring turned out wrong.
- **Keep PRs small and finished before announcing them**, and verify after a merge that every commit reached `main`.
- **Agree the AI-usage header format, and who completes it, on day one**, so it is written at review time, not reconstructed at the end.

### Individual reflections

**Amber Rastella (Security Lead).** I used Claude Code as a pair programmer that drafts quickly and needs checking against reality. The most useful habit was refusing to call an AI feature done until I had used it with the live model and real-sized data. That is how we found the similar-items and alphabetical-cutoff bugs that every test had passed. The most useful correction ran the other way: the AI's first design for AI monitoring was technically complete but felt wrong on the page, and moving it to its own screen was a human judgement it would not have made by itself. Next time I would measure model cost and limits before the demo week, not during it.

\*\*Alexa Stein (Team Lead).Across my contributions — the member lifecycle backend and frontend (invites, roles, deactivation), the Users/Members admin pages, and most recently User Groups and restricted-equipment access control — I used Claude Code as a pair programmer: drafting the layered backend code (routes/services/repositories/models), writing the accompanying tests, and handling mechanical scaffolding like migrations and audit logging. It did well keeping multi-tenant isolation and transactional consistency correct across all of these features without me having to re-explain the pattern each time — once I set the convention (orgId-scoped queries, audit events written inside the same transaction as the state change), it applied it consistently on new work. It got things wrong in smaller ways repeatedly rather than one big failure: generated code occasionally missed our Prettier formatting or introduced response shapes inconsistent with sibling error patterns, so I had to catch those in review rather than trust first output. If I could change one thing, I'd build in a habit of running the full lint/format/test suite as part of what AI considers "done," rather than treating that verification as a separate step I have to prompt for every time.

**Alex Picard (Configuration Lead).** _To be written by Alex._

**Mateus Silva (Requirements Lead).** I used Claude Code for pair programming by letting the AI draft the code, and then I proofread it before accepting it. What it did well was in the TDD process, as writing the unit tests to initially fail and then implementing them afterwards helped me to better understand the importance of each test in the context of the feature, and what error code to expect. One issue that I needed to address was when the AI reverted some changes to some code in the backend, but forgot to re-run the backend test suite before moving on to the frontend portion, and missed some tests in the suite that ended up failing. Next time, I would manually run the test suites myself after every change instead of relying on the AI to run it, and I would cut down on the lines of comments the AI makes.

## **Orelmis Toribio (QA Lead).** I used Claude to draft most of my code, which I then reviewed and tested manually before committing. Beyond code generation, it was especially useful for quickly producing documentation using the context of our project documents and repository history. In my professional experience, documentation on a growing software project is often an afterthought because it's so time-consuming to write by hand, and AI largely removes that barrier to keeping documentation comprehensive and up to date. One thing I would do differently is rely less on the AI for design decisions, particularly around the UI workflow. I think people still have a better sense of what feels natural and intuitive to use. For example, the AI built the interface around Requests, so users track their equipment through the requests they've made. I think it would have been more intuitive to center the interface on Asset-Units instead, with a dedicated "My Equipment" section showing what each user currently has checked out. And just in general, a greater emphasis on object possession rather than request life cycles.

_Sources: AI-usage headers in `code/` and `.github/` (274 files); `git log` (194 non-merge commits); GitHub pull requests #1–#82; Jira SCRUM-184, SCRUM-216, SCRUM-242, SCRUM-243, SCRUM-244; decision records `code/docs/od-9-search-telemetry.md` and `code/docs/od-10-ai-candidate-retrieval.md`. Figures as of 2026-10-11._
