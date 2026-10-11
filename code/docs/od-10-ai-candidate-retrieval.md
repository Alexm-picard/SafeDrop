# OD-10: how AI search picks its candidates (SCRUM-191 spike)

| Field           | Value                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Status**      | **Proposed for team review.** Recommendation below; nothing is built.                                             |
| **Spike**       | SCRUM-191, the Phase 0 spike of SCRUM-147 (semantic candidate retrieval)                                          |
| **Decides**     | The vector store, the embedding model, and **when** SCRUM-147 Phases 1–2 are worth building                       |
| **For the SDD** | §2.6 (AI services). The SDD is not in this repository, so paste the "SDD text" section in, then delete this file. |
| **Number**      | OD-10 is the next free number after OD-9 (od-9-search-telemetry.md). Renumber if needed.                          |

## The question

SCRUM-103 sends the model at most 100 candidates (`MAX_CANDIDATES`): plain-search matches first, then
the catalogue in name order. SCRUM-147 names two limits of that:

1. **Literal matching misses meaning.** "Something to record a lecture" shares no words with "Zoom H5".
2. **Catalogues over 100 assets are truncated alphabetically.** Past the first 100 names, an asset
   reaches the model only if it literally matches the query.

The plan was to fix both with embeddings and vector search. This spike asks which store to use, and
first whether both limits are real today.

## What was measured

Run on 2026-10-10 against the live `asset-search` agent, with the exact request shape the backend
sends. The catalogue was synthetic: 25 kinds of equipment ("Tripod 3", "HDMI Cable 2", …), with
"Zoom H5, handheld 4-track field unit with XY capsule" placed 85% of the way down the list. The query
was "something to record a lecture", which shares no word with the target.

| Candidates sent | Latency | Input tokens | Output tokens | Target found?   |
| --------------: | ------: | -----------: | ------------: | --------------- |
|              20 |   6.5 s |        1,432 |           626 | Yes, ranked 1st |
|              50 |   5.5 s |        2,713 |           639 | Yes, ranked 1st |
|             100 |   4.1 s |        4,847 |           358 | Yes, ranked 1st |

The live app gave the same result: in seeded `org-b`, "something to join a video call" found a
Chromebook and a laptop, neither of which contains any of those words.

What this shows:

- **Limit 1 is already solved, up to the cap.** The model does the semantic matching itself, as long
  as the right asset is among the candidates. Embeddings would not improve ranking for organisations
  with up to 100 assets.
- **Candidate count does not drive latency.** The time is spent in the model's reasoning, which is
  why output tokens vary while input tokens grow. Going from 100 candidates to a top-20 would not make
  searches noticeably faster. (Searches take 4–7 s against a 10 s `FOUNDRY_TIMEOUT_MS`. That margin is
  worth watching, but it is a model setting, not a retrieval problem.)
- **Limit 2 is the real one,** and it starts at the 101st asset. That is where RAG earns its cost.

## Options compared

|                          | **A. Atlas Vector Search**                                                                                                                                                         | **B. Azure AI Search**                                                                                       | **C. Mongo text index**                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Fixes limit 1 (meaning)  | Yes                                                                                                                                                                                | Yes                                                                                                          | **No.** Stemmed word matching: "record" still never matches "Zoom H5" |
| Fixes limit 2 (over 100) | Yes                                                                                                                                                                                | Yes                                                                                                          | Partly: only for assets sharing a word with the query                 |
| Where vectors live       | On the asset document                                                                                                                                                              | A second system, kept in sync with Mongo                                                                     | No vectors                                                            |
| Tenant isolation (SR-2)  | `orgId` as a pre-filter **inside** `$vectorSearch`, as SCRUM-147 AC2 requires                                                                                                      | A filter in a separate service; a sync bug can leak rows the repository layer never sees                     | Ordinary `orgId` query                                                |
| Runs on what we have     | **Yes.** Staging is already on Atlas (README, "Database"). Free clusters allow 3 search or vector indexes, and we use none                                                         | Free tier: 1 per subscription, 50 MB, 3 indexes, and "might be deleted after extended periods of inactivity" | Yes, a migration only                                                 |
| Local dev and tests      | Needs the `mongodb/mongodb-atlas-local` image in place of `mongo:7`; `mongodb-memory-server` cannot run `$vectorSearch`, so retrieval tests need that image or a mocked repository | Mocked service in tests; a real index to exercise it                                                         | Unchanged                                                             |
| New credentials          | None                                                                                                                                                                               | A search admin key in Render                                                                                 | None                                                                  |

SCRUM-147 says Option A "requires moving from self-hosted `mongo:7` to Atlas". That is only true of
local development: staging and the course demo already run on Atlas.

## Recommendation

1. **Store: Atlas Vector Search (A)**, when SCRUM-147 is built. It keeps vectors next to the data they
   describe, so there is nothing to sync, and the tenant filter runs in the same query as the search,
   where SR-2 needs it. B adds a second datastore holding every organisation's catalogue, with a
   free tier that can disappear. C does not fix the problem SCRUM-147 exists for.
2. **Embedding model: `text-embedding-3-small`, deployed in the same Foundry resource,** requested at
   **512 dimensions** and stored as a packed float32 `binData` vector. That is about 2 KB per asset,
   so 10,000 assets is about 20 MB, which matters on a 512 MB free cluster that also holds the audit
   log. Embed `name + category + description` only, as SCRUM-147 already specifies.
3. **Do not build Phases 1–2 yet.** Nothing in the measurements points to a problem below 100 assets,
   and the seeded organisations have three assets each. Building it now means a new Foundry deployment, a
   new local database image, a backfill and a new failure mode, all for no visible change.
4. **The trigger is already instrumented.** `SearchQueryLog.candidateCount` (SCRUM-206) records how
   many candidates each search sent. A search sends the whole catalogue up to the cap, so a count of
   100 means that organisation's catalogue was cut off. Once `GET /api/search-telemetry` shows
   searches sending 100, Phases 1–2 are worth their cost. Until then, SCRUM-147 stays in the
   backlog with this decision attached.

## SDD text (§2.6, AI services: candidate selection)

> **Candidate selection.** The backend selects the assets sent to the model; the model never queries
> the database (SR-2). Up to 100 candidates are sent: plain-search matches first, then the catalogue
> in name order. For alternatives (SCRUM-151/184), the asset's category comes first. Measured against
> the live agent, the model matches by meaning within that set, so no embedding step is used.
>
> **Planned: semantic retrieval for large catalogues (SCRUM-147).** When an organisation's catalogue
> exceeds 100 assets, candidates will come from MongoDB Atlas Vector Search: `text-embedding-3-small`
> embeddings (512 dimensions) of each asset's name, category and description, stored on the asset
> document and queried with `orgId` as a pre-filter inside `$vectorSearch`. Azure AI Search was
> rejected as a second datastore to keep in sync, and a Mongo text index because it does not match by
> meaning (OD-10). The trigger to build it is search telemetry showing searches sending the full 100
> candidates.

## Sources

- Live measurements: see "What was measured" above.
- Atlas Search free and Flex cluster limits (3 indexes "regardless of the type, `search` or `vector`"):
  <https://www.mongodb.com/docs/atlas/atlas-search/limitations/>
- Atlas Vector Search overview (versions, pre-filtering):
  <https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/>
- Running `$vectorSearch` locally with `mongodb/mongodb-atlas-local`:
  <https://www.mongodb.com/docs/search/self-managed/current/installation/quick-start/>
- Azure AI Search service limits (free tier):
  <https://learn.microsoft.com/en-us/azure/search/search-limits-quotas-capacity>
- Foundry model retirement schedule (check `text-embedding-3-small` before deploying):
  <https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/model-lifecycle-retirement>
