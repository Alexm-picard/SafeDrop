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

No code lives here yet on purpose.
