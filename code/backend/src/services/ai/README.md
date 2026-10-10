# AI services (Iteration 2–3)

Reserved for the Microsoft Foundry integrations planned in SDD §2.6:

- AI-assisted catalogue search / recommendations (Iteration 2, desirable)
- Borrower reliability assessment from audit history (Iteration 3, optional)
- Asset depreciation projection (Iteration 3, optional)

Rules that already apply:

- Foundry is called **only from the backend** (this folder). The SPA never holds an AI key.
- Prompts must never include another tenant's data; every call takes `orgId` first like a repository.
- Log the model, prompt hash and latency per call; never log raw member data.
- `SearchQueryLog` (Lab 2) exists as of **SCRUM-206** and stores operational telemetry only. Where
  Lab 2 and the rule above disagreed, the rule won: no query text, neither raw nor recoverable, and
  no user id (see "Search telemetry" below and code/docs/od-9-search-telemetry.md).

## What exists now

`foundry.client.js` — the transport every AI feature goes through, and nothing else. It owns
authentication, the timeout, how an upstream failure becomes a `ServiceUnavailableError`, and what
reaches the log. It knows nothing about search, scoring or depreciation; those build their own
request bodies and call it.

```js
import { foundryRequest, isFoundryEnabled } from './foundry.client.js';

if (!isFoundryEnabled()) {
  return plainCatalogueSearch(orgId, query); // AI is an enhancement, not a dependency
}
const result = await foundryRequest(orgId, '/openai/deployments/<name>/chat/completions', body, {
  prompt,
});
```

Three things it enforces, so no feature has to remember them:

- **`orgId` first**, the same rule the repository layer follows. A call cannot be written without
  naming the organisation it belongs to.
- **Every failure is a 503** with the upstream detail kept as `cause`. Foundry's error bodies quote
  the offending request back, prompt included, so they are never forwarded to the client — and never
  written to the log at any level, not even debug.
- **Logs carry a prompt hash, never a prompt.** The model, `orgId`, latency and status are recorded;
  the query text and the model's answer are not.

Configuration lives in `.env` (`FOUNDRY_*`). The feature is off by default, and enabling it without
an endpoint, key and deployment fails the boot rather than degrading to a 503 on every search.

`prompts/asset-search.md` — the system prompt for the `asset-search` agent, kept here rather than
only in the Foundry portal because a prompt is where this feature's safety rules live: it should be
reviewable and diffable like any other security control. It also records why the agent is **not**
connected to MongoDB directly, and the request contract the search service has to build.

`assetSearch.service.js` — AI-assisted catalogue search (SCRUM-103) and the recommended-alternatives
pipeline it is reused for (SCRUM-151). The backend picks the candidates; the model only ranks them.

`searchTelemetry.service.js` — the only writer of `SearchQueryLog` (SCRUM-206), and the summary
behind `GET /api/search-telemetry`.

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

## Deferred, and a decision rather than drift

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
