# AI services

Microsoft Foundry powers two features, both built in Iterations 2 and 3 and designed in SDD §7.3:

- **AI-assisted catalogue search** (SCRUM-103): a member describes what they need in their own words
  and gets matching assets, each with a one-line reason.
- **Similar items** (SCRUM-151, SCRUM-184): on an asset with no available unit, comparable assets the
  member could borrow instead.

The two features once planned for Iteration 3 (borrower reliability scoring and depreciation
projection) were not built.

Rules that apply to everything in this folder:

- Foundry is called **only from the backend** (this folder). The SPA never holds an AI key.
- Prompts must never include another tenant's data; every call takes `orgId` first like a repository.
- Log the model, prompt hash and latency per call; never log raw member data.
- `SearchQueryLog` stores operational telemetry only: no query text, neither raw nor recoverable, and
  no user id (see "Search telemetry" below and code/docs/od-9-search-telemetry.md).
- **AI is an enhancement, not a dependency.** Every AI path has a non-AI answer, and a member is never
  shown an error because of the model.

## What exists now

`foundry.client.js`: the transport every AI feature goes through, and nothing else. It owns
authentication, the deadline, the one retry, how an upstream failure becomes a
`ServiceUnavailableError`, and what reaches the log. It knows nothing about search; callers build
their own request bodies.

```js
import { foundryRequest, isFoundryEnabled } from './foundry.client.js';

if (!isFoundryEnabled()) {
  return plainSearch(orgId, query); // AI is an enhancement, not a dependency
}
const reply = await foundryRequest(orgId, { input }, { prompt: input });
```

What it enforces, so no feature has to remember it:

- **`orgId` first**, the same rule the repository layer follows. A call cannot be written without
  naming the organisation it belongs to.
- **Every failure is a 503** with the upstream detail kept as `cause`. Foundry's error bodies quote
  the offending request back, prompt included, so they are never forwarded to the client, and never
  written to the log at any level, not even debug.
- **One deadline, at most one retry** (SCRUM-244). A network error, 429 or 5xx is retried once,
  after the wait Foundry asks for in `retry-after-ms` / `retry-after` (capped at 3 s; 1 s for a 429
  with no hint, 400 ms otherwise). A timeout or any other 4xx is not retried. Both attempts share
  one `FOUNDRY_TIMEOUT_MS` deadline, so a retry never makes a member wait longer.
- **Logs carry a prompt hash, never a prompt.** The model, `orgId`, latency and status are recorded;
  the query text and the model's answer are not.

`prompts/asset-search.md`: the system prompt for the `asset-search` agent, kept here rather than
only in the Foundry portal because a prompt is where this feature's safety rules live: it should be
reviewable and diffable like any other security control. It also records why the agent is **not**
connected to MongoDB directly, and the request contract the search service has to build.

`assetSearch.service.js`: catalogue search (SCRUM-103) and similar items (SCRUM-151). The backend
picks the candidates; the model only ranks them. How a search runs is below.

`searchTelemetry.service.js`: the only writer of `SearchQueryLog` (SCRUM-206), and the summary
behind `GET /api/search-telemetry`, which the admin **AI search** page reads (SCRUM-242).

## How a search runs

1. **Candidates (backend, tenant-scoped).** At most `AI_MAX_CANDIDATES` (100) assets, chosen in this
   order (SCRUM-243): those containing the query as typed, then those containing the most of its
   words (`queryWords`: stop words dropped, endings trimmed, at most 8 words), then the catalogue in
   name order. Similar items instead puts the asset's own category first, then the rest, keeping only
   assets the caller could borrow right now (SCRUM-184).
2. **The model ranks.** Each candidate is sent with its id, name, category, description and units'
   tag, status and condition, and nothing else.
3. **The answer is checked.** It must fit the JSON contract (a Zod schema); any id that was not a
   candidate is dropped, never looked up.
4. **Fallbacks.** AI off, Foundry failing, or an answer outside the contract: search returns plain
   matches (the phrase, then word matches, SCRUM-244); similar items returns the same-category
   candidates unranked. Results say which they are: "Ranked by AI" / "Suggested by AI", or "Showing
   text matches".

## Operating it

**Configuration.** `FOUNDRY_ENABLED`, `FOUNDRY_ENDPOINT`, `FOUNDRY_API_KEY`, `FOUNDRY_DEPLOYMENT` in
`.env` locally and in the Render dashboard for staging. Off by default; enabling it without the
endpoint, key and deployment fails the boot. `FOUNDRY_TIMEOUT_MS` defaults to 15000: answers take
4-7 s, with a p95 near 9 s on a realistic catalogue.

**Rate limits are the failure you will actually see.** Measured on 2026-10-11 against the
`asset-search` agent (gpt-5-mini): one search over a 95-asset catalogue is about **9,300 tokens**
(8,300 in, about 1,000 out). Azure enforces a deployment's tokens-per-minute limit over short windows
too, roughly a sixth per 10 seconds, so at the default **50K TPM** two searches within 10 seconds
already risk a **429**. That is what staging hit with several people searching at once. Raise the
deployment's TPM limit in the Foundry portal (about 300K comfortably covers a five-person demo);
limits cost nothing until used. The retry and the 600 ms search debounce soften the problem but cannot
lift the limit.

**Where to look.** Admins: **Manage → AI search** shows a status line, searches per day, typical
wait, no-results rate, why searches fell back, and whether the catalogue outgrew the candidate limit;
the Overview shows a notice only when something needs attention. Operators: the API log's `foundry`
lines carry each call's status and latency (`foundry returned an error status` with `status: 429` is
the rate limit).

**Demo data.** `npm run seed:catalog` adds a 90-asset demo catalogue to `org-b` locally (`--count`,
`--org`, `--dry-run`, `--remove`); on staging, the manual Actions workflow **Seed demo catalog
(staging)** runs the same script with the existing `MONGODB_URI_STAGING` secret.

## Search telemetry (SCRUM-206)

Every search, and every alternatives lookup that reaches the AI pipeline, writes one row to
`searchquerylogs`:

| Field            | Meaning                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `orgId`          | the organisation                                                                     |
| `timestamp`      | server time; also what the 90-day TTL index deletes by                               |
| `kind`           | `search` or `alternatives`                                                           |
| `assetId`        | the asset, for `alternatives` only — organisation data, not member input             |
| `aiAssisted`     | whether the model's ranking was used                                                 |
| `fallbackReason` | `null`, `disabled` (AI off), `unavailable` (Foundry failed), `contract` (bad output) |
| `latencyMs`      | the whole search, not just the Foundry call                                          |
| `candidateCount` | catalogue entries sent to the model; 0 when it was not asked                         |
| `resultCount`    | results the member was shown; 0 is a zero-result search                              |

What it does **not** store, by design:

- **No query text, and nothing derived from it.** There is no field for it, and the schema is
  `strict: 'throw'`, so adding one is a visible change to the model rather than a stray property.
- **No user id.** Organisation + timestamp + user is a search history.

Three more rules:

- **Retention is enforced by MongoDB**, through a TTL index on `timestamp`
  (`migrations/20261010000000-search-query-log.js`), not by a job someone has to remember to run.
- **Writing telemetry can never break a search.** `recordSearch()` is fire-and-forget with the
  failure caught and logged — the opposite of the audit rule (OD-2), because a search changes nothing.
- **Admins see aggregates only.** `GET /api/search-telemetry` (`audit:read`, ORG_ADMIN) returns counts,
  rates and latency percentiles for the caller's organisation; there is no route that returns rows.
  It also returns `candidateCapHits` (searches that sent the full 100 candidates, meaning the
  catalogue was cut off: OD-10's trigger for SCRUM-147) and `daily` (zero-filled UTC days, ranked vs
  fell back), which the AI search page charts (SCRUM-242).

## Deferred, and a decision rather than drift

**Semantic retrieval (RAG) is deferred, with a trigger.** OD-10 (code/docs/od-10-ai-candidate-retrieval.md,
SCRUM-191) measured the live agent and found it already matches by meaning within the 100-candidate
set, so vector search only pays off for catalogues over 100 assets. When it is needed, the decision is
recorded: MongoDB Atlas Vector Search with `orgId` as a pre-filter inside `$vectorSearch`, and
`text-embedding-3-small` at 512 dimensions. SCRUM-147 and SCRUM-192 sit in the backlog until the AI
search page reports searches reaching the limit.

**The demand signal is out of scope, and the team decided not to build it.** SCRUM-206 was deliberately narrowed to
operational telemetry — fallback rate, latency, zero-result rate — none of which needs the member's
words. The one use that genuinely does is a demand signal: _"what are members searching for that we do
not stock?"_ That was taken out of SCRUM-206 rather than smuggled in, because it is the only part with
real privacy exposure, and the team agreed not to implement it for security and privacy reasons. If
that is ever revisited it needs its own story and its own recorded position: opt-in per organisation,
aggregate-only, no link to a user, and a k-anonymity threshold so no stored row can describe one
person's search.

**A caveat that applies to anything stored.** `promptFingerprint` is for correlating identical prompts
in logs; it is not a privacy control. Search queries are short and low-entropy ("canon r6",
"projector"), so a plain hash of one is recoverable by dictionary attack by anyone who can read the
collection. Anything persisted must be an HMAC keyed with a secret that does not live in the database
— or, better, not persisted at all.
