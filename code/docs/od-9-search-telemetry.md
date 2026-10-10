# OD-9: what SearchQueryLog may store (SCRUM-206)

| Field          | Value                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **Status**     | **Decided by the team** (demand signal dropped). Retention window still to confirm.                 |
| **Story**      | SCRUM-206                                                                                           |
| **Supersedes** | The `SearchQueryLog` fields sketched in Lab 2                                                       |
| **Number**     | OD-9 is a proposed number: the next free one after OD-8 in sdd-v0.2-changes.md. Renumber if needed. |

## The conflict

Two of the project's own documents disagreed about this model:

- **Lab 2** sketched `SearchQueryLog` as a record of searches, query text included.
- **`code/backend/src/services/ai/README.md`**, written later, says the AI layer must "never log raw
  member data" and that "the query text and the model's answer are not" recorded.

Whoever built the model would have had to pick one. This record says which, so nobody has to pick it
silently.

## The decision

Lab 2's model was really doing two different jobs, and we split them:

| Goal                                                                  | Needs the search text?     | Decision                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Operational telemetry**: fallback rate, latency, zero-result rate   | No                         | **Built** as `SearchQueryLog`                                                                                                |
| **Demand signal**: "what do members search for that we do not stock?" | Yes, or an aggregate of it | **Not built.** The team agreed it is the only part with real privacy exposure, and it is not worth that risk this iteration. |

`SearchQueryLog` therefore stores:

- `orgId`, `timestamp`, `kind` (`search` / `alternatives`)
- `aiAssisted` and `fallbackReason` (`null`, `disabled`, `unavailable`, `contract`)
- `latencyMs`, `candidateCount`, `resultCount`
- `assetId`, for alternatives lookups only (an asset is organisation data, not member input)

It deliberately does **not** store:

- **The query text, or anything reversible derived from it.** A plain hash does not count as safe:
  search queries are short and guessable, so hashing a word list recovers them in seconds. If a
  fingerprint is ever persisted, it must be an HMAC keyed with a secret that is not in the database.
- **The user.** Organisation + timestamp + user id is a per-person search history. The audit log
  already covers actions that change state, and a search changes nothing.

## Consequences

- **Retention:** rows are deleted after 90 days by a MongoDB TTL index. 90 days is the story's
  proposal and is still open for the team to confirm or shorten.
- **Failure handling is the opposite of OD-2.** An audit row commits in the same transaction as the
  change it describes. A telemetry row is written fire-and-forget, outside any transaction, so a
  failed write never costs a member their search results.
- **Access:** org admins read aggregates only, through `GET /api/search-telemetry` behind
  `audit:read`, scoped to their own organisation. No route returns individual rows.
- **Scope:** the recommended-alternatives feature (SCRUM-151) is logged too, as `kind: alternatives`,
  because it runs the same AI pipeline and has the same three fallbacks.
