# STD test cases: AI-recommended alternatives (SCRUM-151)

|             |                                                                                                                                                 |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Story**   | SCRUM-151 — AI-recommended alternatives when an asset is unavailable                                                                            |
| **Subtask** | SCRUM-189 — record and summarise this story's test cases for the Iteration 2 STD                                                                |
| **Author**  | Mateus Silva                                                                                                                                    |
| **Status**  | Complete. Every case below is implemented and passing; none is planned or aspirational.                                                         |
| **Totals**  | 29 automated cases — 22 backend, 7 frontend                                                                                                     |
| **Built**   | Test-first. Each case was written and run failing before the code that satisfies it, except where marked **inherited** or **regression** below. |

## 1. How to read this

The STD's table wants one row per test case. The rows are grouped by the acceptance criterion they
cover, and each names the file it lives in so a reviewer can run it.

Three cases are marked **inherited** and three **regression**. Those passed the first time they ran,
and they are labelled rather than counted as test-first evidence:

- **inherited** — the behaviour already existed, from the repository layer or from an earlier story.
  The case documents and protects it; it did not drive any code in this story.
- **regression** — written after the implementation, usually because the case asserts the _absence_ of
  something and therefore cannot fail before the thing exists.

This distinction matters for the STD because a column of 29 passing tests otherwise implies 29 pieces
of verified new work, and three of these verify work that was already done.

## 2. Test environment

|                     |                                                                                                                          |
| :------------------ | :----------------------------------------------------------------------------------------------------------------------- |
| Runner              | Vitest 5.0.1                                                                                                             |
| Backend integration | Supertest against the Express app; MongoDB replica set (in-memory on a developer machine, the `mongo` service in Docker) |
| Backend unit        | Real repositories against a per-file database; `foundry.client.js` mocked                                                |
| Frontend            | React Testing Library + jsdom; MSW for the API                                                                           |
| Fixtures            | `tests/helpers/seedTwoOrgs.js` (backend), `tests/mocks/handlers.js` (frontend)                                           |

**Foundry is mocked in every case.** The model is slow, costs money per call and answers differently
each time, so no automated case here asserts anything about the quality of its ranking. What is
tested is the service's own decisions: which candidates it is willing to show the model, and what it
trusts coming back. Model output quality is covered by manual exploratory testing, recorded
separately.

## 3. Backend — service cases

File: `code/backend/tests/unit/services/assetAlternatives.test.js` (15 cases)

| #   | Covers     | Case                                                                                         | Expected result                                                                                                   |
| :-- | :--------- | :------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| 1   | AT-1       | Fully-out Canon EOS R6, available Sony A7 IV in the same category, model ranks the A7        | 200-equivalent service result: one alternative, carrying the model's reason, `aiAssisted: true`                   |
| 2   | AT-2       | Model names an asset belonging to **another organisation**                                   | That id is never sent to the model, and never returned (SR-2)                                                     |
| 3   | AT-2       | Model names a **retired** asset — **inherited** (`search`/`list` exclude retired, SCRUM-145) | Not sent, not returned                                                                                            |
| 4   | AT-2       | Model names an asset whose units are all OUT / REQUESTED / MAINTENANCE                       | Not sent, not returned                                                                                            |
| 5   | AT-2       | Model names an asset **restricted to a group the caller is not in**                          | Not sent, not returned                                                                                            |
| 6   | AT-2       | Restricted asset the caller **is** eligible for — **regression**                             | Sent, and returned: the filter must not pass by excluding everything restricted                                   |
| 7   | AT-3       | Foundry switched off                                                                         | Fallback list, `aiAssisted: false`, Foundry never called                                                          |
| 8   | AT-3       | Foundry call fails (`ServiceUnavailableError`)                                               | Fallback list, no error raised to the caller                                                                      |
| 9   | AT-3       | Model returns prose instead of the contracted JSON                                           | Fallback list, no error raised                                                                                    |
| 10  | AT-3, SR   | Upstream error message quotes the prompt back                                                | Nothing from upstream appears in the response, and the prompt appears in no log line at any level, debug included |
| 11  | AT-3, AT-2 | Fallback path with an unavailable, a cross-tenant and an ineligible candidate present        | All three excluded; the fallback applies the same filters as the AI path                                          |
| 12  | AT-3       | Six available candidates, Foundry off                                                        | At most five returned                                                                                             |
| 13  | —          | Eight available candidates, Foundry on, model ranks all eight                                | At most five returned, in the model's order                                                                       |
| 14  | AT-4       | Asset has one AVAILABLE unit among others that are out                                       | Foundry **not called**; `{ alternatives: [], aiAssisted: false }`                                                 |
| 15  | AT-4       | Asset has no units at all                                                                    | Foundry **not called**; empty result                                                                              |

## 4. Backend — endpoint cases

File: `code/backend/tests/integration/routes/assetAlternatives.test.js` (7 cases)
Endpoint: `GET /api/assets/:id/alternatives`, permission `assets:read`

| #   | Covers     | Case                                                                                 | Expected result                                                     |
| :-- | :--------- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------ |
| 16  | AT-1       | Member opens an asset with no available units                                        | 200, alternatives present, the asset itself absent from them        |
| 17  | AT-2, SR-2 | Member asks for **another organisation's** asset id                                  | 404 `NOT_FOUND` — never 403, and never a 200 carrying an empty list |
| 18  | AT-2       | Asset id that does not exist anywhere                                                | 404 `NOT_FOUND`, identical to case 17                               |
| 19  | —          | Malformed id (`not-an-id`)                                                           | 400 `VALIDATION_ERROR`, rejected before the service runs            |
| 20  | —          | No session                                                                           | 401                                                                 |
| 21  | —          | MEMBER, APPROVER and ORG_ADMIN each ask — **inherited** (`assets:read` is universal) | 200 for all three                                                   |
| 22  | AT-4       | Asset that still has an available unit                                               | 200 with `{ alternatives: [], aiAssisted: false }` — not an error   |

Cases 19, 20 and 21 are also exercised automatically by
`tests/integration/security/routePermissions.test.js`, which walks the live Express route table and
applies the no-session and role-matrix checks to every registered route, including this one.

## 5. Frontend cases

File: `code/frontend/tests/unit/components/SimilarItems.test.jsx` (5 cases)

| #   | Covers | Case                                               | Expected result                                                                                    |
| :-- | :----- | :------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| 23  | AT-1   | Section renders for a dead-end asset               | Loading state, then each recommendation with its name, its reason, and a link to that asset's page |
| 24  | AT-4   | `enabled={false}`                                  | No request is made at all, and no section renders                                                  |
| 25  | AT-3   | API returns `aiAssisted: false` and `reason: null` | The item is listed with "Available now" in place of a model's reason                               |
| 26  | AT-3   | API returns an empty list — **regression**         | Nothing renders: no section and no empty heading                                                   |
| 27  | AT-3   | API returns 503 — **regression**                   | Nothing renders, and no error text or alert appears                                                |

File: `code/frontend/tests/unit/components/AssetDetailPage.test.jsx` (2 cases)

| #   | Covers | Case                                           | Expected result                                      |
| :-- | :----- | :--------------------------------------------- | :--------------------------------------------------- |
| 28  | AT-1   | Asset with one HELD unit and nothing available | Section renders, and exactly **one** request is made |
| 29  | AT-4   | Asset with an AVAILABLE unit                   | No section, and **zero** requests are made           |

Cases 28 and 29 assert the request _count_, not only what rendered. A section that quietly rendered
nothing would still have cost a round trip on every asset page view, which is the cost AT-4 exists to
prevent.

## 6. Verification beyond the per-case assertions

Two cases were checked by deliberately breaking the code they guard, to confirm they can fail. Both
mutations were reverted; neither is in the delivered code.

| Case   | Mutation applied                                                                                     | Result                                                                                  |
| :----- | :--------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| 6      | `filterEligible` rewritten to drop every restricted asset — the plausible way to pass case 5 wrongly | Case 6 fails, no other case fails                                                       |
| 26, 27 | The empty-list guard removed from `SimilarItems`                                                     | Both fail with "promise resolved `<section>…` instead of rejecting"; nothing else fails |

This was done because cases 6, 26 and 27 all passed on their first run. A test that has never failed
has not been shown to test anything.

## 7. Full-suite results at the time of writing

| Suite                               | Result                                     |
| :---------------------------------- | :----------------------------------------- |
| Backend, whole suite                | 985 passed, 6 skipped, 0 failed (44 files) |
| Frontend, whole suite               | 349 passed, 1 todo, 0 failed (34 files)    |
| Lint (ESLint) and format (Prettier) | Clean, both packages                       |

The 6 backend skips are `tests/integration/security/auditDbRole.test.js`, skipped by design pending
SCRUM-125 (the database-level insert-only audit role), and are unrelated to this story.

## 8. Not covered by automated tests

Stated so the STD does not imply more coverage than exists.

- **Ranking quality.** Whether the model's chosen alternative is genuinely comparable is not asserted
  anywhere, because the model is mocked in every case. Covered by manual exploratory testing against
  a live Foundry deployment.
- **The live prompt.** `prompts/asset-search.md` is exercised only through recorded fixtures. A change
  to it that confuses the model would not fail any case here.
- **Latency.** No case asserts that the endpoint responds inside any particular time; NFR work on the
  AI path is not in this story.
- **Concurrency.** No case covers two members opening the same dead-end page at once; nothing in this
  path writes, so there is no race to close.

## 9. Deviations from the acceptance criteria as written

For the STD's traceability column, and for updating SCRUM-151 itself.

| AC          | As written                                               | As built, and why                                                                                                                                                                                                                                                                                                                 |
| :---------- | :------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-3        | "up to five available assets from the **same category**" | Up to five from the **same candidate set as the AI path** — the whole catalogue, narrowed by the AT-2 filters. Foundry can be up for one request and down for the next, and a fallback scoped more narrowly would make the section's contents change kind rather than just lose their ranking. Agreed with the Requirements lead. |
| AT-1        | "a link to **request** it"                               | A link to the recommended asset's own page, labelled "View <name>". Requesting needs a unit and a date range, which that page already asks for; a one-click Request here would promise something it cannot finish. Same journey, named for what the link does.                                                                    |
| Design note | `GET /api/assets/:assetId/alternatives`                  | `GET /api/assets/:id/alternatives`, reusing the shared `idParams` schema like the other nine routes on that router. The ticket called the path a proposal.                                                                                                                                                                        |
| —           | Not stated                                               | The AI path is also capped at five. The model's output contract allows ten, so without the cap the section would hold ten options with Foundry up and five with it down.                                                                                                                                                          |
| —           | Not stated                                               | The section is offered to every role, not only members: anyone who can browse the catalogue can be stuck in front of a dead end.                                                                                                                                                                                                  |
