# AI services (Iteration 2–3)

Reserved for the Microsoft Foundry integrations planned in SDD §2.6:

- AI-assisted catalogue search / recommendations (Iteration 2, desirable)
- Borrower reliability assessment from audit history (Iteration 3, optional)
- Asset depreciation projection (Iteration 3, optional)

Rules that already apply:

- Foundry is called **only from the backend** (this folder). The SPA never holds an AI key.
- Prompts must never include another tenant's data; every call takes `orgId` first like a repository.
- Log the model, prompt hash and latency per call; never log raw member data.
- `SearchQueryLog` (Lab 2) is created here in Iteration 2, not before.

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

Still to come: the feature services themselves, and the `SearchQueryLog` model.
