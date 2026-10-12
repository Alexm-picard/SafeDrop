# SafeDrop: AI Usage Summary and Team Reflection

CS673 Team 3 · Iteration 3 · SCRUM-227

## Part 1: AI usage summary

### Tools

| Tool                                                     | Used for                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code** (Anthropic), in VS Code and the terminal | Writing and changing code, writing tests, reviewing diffs, drafting documentation and decision records, diagnosing failures from logs, and Jira and GitHub housekeeping |
| **Microsoft Foundry** (`asset-search` agent, gpt-5-mini) | A product feature, not a development tool: it ranks catalogue search results and similar-item suggestions at run time                                                   |

Claude Code is the only development tool named in any file header. Every one of the 274 headers that records a tool names it.

### Headline metrics

| Metric                                                 | Value                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **AI contribution to code** (file headers)             | **about 92%** (mean over 274 files; median 90%, range 60–100%)                  |
| **AI contribution to documents** (each document's log) | **about 55%** (mean of 11 logged entries in the SPPP, STD and SDD; range 5–85%) |
| Commits with a `Co-Authored-By: Claude` trailer        | 74 of 194 (38%)                                                                 |
| Pull requests merged after review by another member    | 79 of 82 (63 with a formal approval; none self-merged without one)              |
| Automated tests guarding AI-written code               | about 1,190 backend and 450 frontend, with an 80% line-coverage floor           |

### Code

The code figure comes from the AI-usage header every source file carries. Each header records the share of the file first produced by the AI, entered by the author and confirmed by the reviewer (SCRUM-216). By area the figures are close together: backend source 91%, backend tests 92%, frontend source 93%, frontend tests 93%, CI workflows 90%.

The commit figure measures something different: only commits that kept a `Co-Authored-By: Claude` trailer. The trailer was not used consistently, so 38% is a lower bound on how often the AI was involved in a change, not a competing estimate.

### Documents

Each of our documents keeps its own AI usage log, one row per AI-assisted revision:

| Document | Logged entries | AI contribution per entry                                                                             |
| -------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| SPPP     | 4              | 5% and 5% (option comparisons), 50% (non-functional requirements), 60% (Iteration 1 reconciliation)   |
| STD      | 3              | 75% (automated test report), 20% (QA metrics, measured by the QA Lead), 85% (Iteration 2 additions)   |
| SDD      | 4              | 80% (initial draft), 70% (verification pass), 70% (Iteration 2 updates), 85% (Iteration 3 AI section) |

Documents are more mixed than code: the AI drafted most of the SDD and the test reports, while the plan (SPPP) was largely written by hand. Taken together, **most code and tests were first drafted by AI, about half of the documentation was, and the team's work was specifying, reviewing, testing and deciding.**

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

**Test-first with an AI writing both halves.** Asking for the failing test before the code kept each change tied to what was asked; a test written afterwards tends to restate what the code does. The defects we found later were mostly in behaviour the tests could not see. **Decision records with evidence** (OD-9, OD-10) put each question, its options and a measurement in one place: OD-10 deferred vector search after measuring that the model already matched by meaning. **Security rules stayed out of the AI's discretion.** The agent never gets database access, and any asset id it returns that was not offered is dropped, so a model mistake can produce a wrong answer but not a data leak.

### What did not

**Mocked tests gave false confidence about AI behaviour.** The search tests mock Foundry, so the suite could not see whether the model's answers made sense, and two real defects passed every test. **Bookkeeping lagged behind the work:** at the end of Iteration 2, 84 of 217 headers still said "pending team review", our largest AI Usage deduction, and 11 headers had been removed by mistake. **Large AI-written changes are hard to review:** 63 of 82 PRs got a formal approval, and twice a PR was merged before its author had finished pushing to it (#78, #81).

### Where the AI was wrong, and how we caught it

| What the AI produced                                                                                                              | How it was caught                                           | Fix                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Similar items recommended a camera and a projector for a laptop "because both names contain B". All tests passed.                 | Using the feature against the live model                    | SCRUM-184: same-category candidates first, and a same-category fallback |
| AI search sent the model the first 100 items alphabetically, so "draw digital art" never saw the Wacom tablets. All tests passed. | Testing with a realistic 125-item catalogue                 | SCRUM-243: candidates ranked by matching words                          |
| After a local test passed, the AI concluded the staging failures were "not a rate limit".                                         | The staging logs: every failure was a 429                   | SCRUM-244: retry as Foundry asks; token limit raised                    |
| A first design put AI monitoring as a card on the admin Overview                                                                  | Human visual review: "random and static" on a page of tasks | Its own page, with an Overview notice only when needed                  |
| An instruction to remove AI-usage headers stayed in the AI's saved memory after headers became a deliverable                      | Amber noticed the conflict                                  | Instruction reversed and the memory corrected                           |

The AI was most often wrong where the truth lived outside the code: in a model's actual behaviour, in production logs, or in how a screen felt to use. Running the system caught these; unit tests did not.

### What we would do differently

- Make "run it live with realistic data" part of done for anything involving the model, and seed a realistic catalogue from the first iteration.
- Measure model cost, latency and limits before estimating them.
- Keep PRs small and finished before announcing them.
- Agree the AI-usage header format, and who completes it, on day one.

### Individual reflections

**Amber Rastella (Security Lead).** I used Claude Code as a pair programmer that drafts quickly and needs checking against reality. My most useful habit was not calling an AI feature done until I had used it with the live model and real-sized data, which is how we found two search bugs that every test had passed. The most useful correction ran the other way: the AI's first monitoring design was complete but felt wrong on the page, and moving it was a human judgement. Next time I would measure model limits before demo week.

**Alexa Stein (Team Lead).** Across my contributions — the member lifecycle backend and frontend (invites, roles, deactivation), the Users/Members admin pages, and most recently User Groups and restricted-equipment access control — I used Claude Code as a pair programmer: drafting the layered backend code (routes/services/repositories/models), writing the accompanying tests, and handling mechanical scaffolding like migrations and audit logging. It did well keeping multi-tenant isolation and transactional consistency correct across all of these features without me having to re-explain the pattern each time — once I set the convention (orgId-scoped queries, audit events written inside the same transaction as the state change), it applied it consistently on new work. It got things wrong in smaller ways repeatedly rather than one big failure: generated code occasionally missed our Prettier formatting or introduced response shapes inconsistent with sibling error patterns, so I had to catch those in review rather than trust first output. If I could change one thing, I'd build in a habit of running the full lint/format/test suite as part of what AI considers "done," rather than treating that verification as a separate step I have to prompt for every time.

**Alex Picard (Configuration Lead).** _To be written by Alex._

**Mateus Silva (Requirements Lead).** I used Claude Code for pair programming by letting the AI draft the code, and then I proofread it before accepting it. What it did well was in the TDD process, as writing the unit tests to initially fail and then implementing them afterwards helped me to better understand the importance of each test in the context of the feature, and what error code to expect. One issue that I needed to address was when the AI reverted some changes to some code in the backend, but forgot to re-run the backend test suite before moving on to the frontend portion, and missed some tests in the suite that ended up failing. Next time, I would manually run the test suites myself after every change instead of relying on the AI to run it, and I would cut down on the lines of comments the AI makes.

**Orelmis Toribio (QA Lead).** I used Claude to draft most of my code, which I then reviewed and tested manually before committing. Beyond code generation, it was especially useful for quickly producing documentation using the context of our project documents and repository history. In my professional experience, documentation on a growing software project is often an afterthought because it's so time-consuming to write by hand, and AI largely removes that barrier to keeping documentation comprehensive and up to date. One thing I would do differently is rely less on the AI for design decisions, particularly around the UI workflow. I think people still have a better sense of what feels natural and intuitive to use. For example, the AI built the interface around Requests, so users track their equipment through the requests they've made. I think it would have been more intuitive to center the interface on Asset-Units instead, with a dedicated "My Equipment" section showing what each user currently has checked out. And just in general, a greater emphasis on object possession rather than request life cycles.

_Sources: AI-usage headers in `code/` and `.github/` (274 files); the AI usage logs in the SPPP, STD (Iteration 2) and SDD (Iteration 3); `git log` (194 non-merge commits); GitHub pull requests #1–#82; Jira SCRUM-184, SCRUM-216, SCRUM-242, SCRUM-243, SCRUM-244; decision records `code/docs/od-9-search-telemetry.md` and `code/docs/od-10-ai-candidate-retrieval.md`. Figures as of 2026-10-11._
