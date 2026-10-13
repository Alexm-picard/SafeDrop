# CLAUDE.md — SafeDrop (CS673OLF26P3, Team 3)

This file is loaded automatically by Claude Code at the start of every session in this repo. Keep it current as the project evolves — it's the fastest way to avoid re-explaining context every session.

## Project Overview

SafeDrop is an organizational inventory management and asset checkout platform, built for CS673 (Software Engineering), a Boston University Software Development master's program course. The project follows an iterative/incremental process across weekly labs and deliverables.

- **Repo**: `BUMETCS673/CS673OLF26P3`
- **Team**: Team 3 — Alexa (Team Lead), Amber Rastella (Security), Alex Picard (Configuration), Mateus Silva (Requirements), Orelmis Toribio (QA)
- **Requirement/project management**: Jira
- **Document generation**: `docx-js` for reports, Graphviz for UML diagrams

## Tech Stack

- **MERN**: MongoDB Atlas, Express, React, Node.js
- **Containerization**: Docker, three-container Compose setup — `backend`, `frontend`, local `mongodb`
  - Explicitly set `container_name` in `docker-compose.yml` for each service (Compose auto-generates names otherwise, e.g. `safedrop-backend-1`)
  - Don't run `docker exec` from inside a subdirectory before containers are up — causes errors
- **Infra**: Docker Compose, MongoDB Atlas (cloud), local Mongo container for dev

## Current Domain Model (as of Lab 2)

Entity classes: `Session`, `SearchQueryLog` (replaced earlier `CheckoutRequest` and `AuditLogEntry` after the model was revised).

Finalized user stories:

- Set Up an Organization Portal (Essential, 8 pts)
- Secure Login and Session Management (Essential, 5 pts)
- Admin Dashboard Overview (Essential, 5 pts)
- AI-Assisted Natural-Language Asset Search (Desirable, 8 pts)

> Note: the initial story set was replaced after discovering overlap with a teammate's claimed features — always check Jira for current ownership before starting new work.

## Dev Commands

```bash
docker compose up --build     # build and start all three containers
docker compose down           # stop and remove containers
docker exec -it safedrop-backend-1 sh   # shell into backend (containers must be running first)
```

_(Update this section with actual test/lint commands once established.)_

## Working Conventions

- Request edits to specific sections/files rather than full regenerations — keep changes scoped and surgical.
- Deliverables (lab reports, SPPP, etc.) are Word docs (.docx), importable to Google Docs — code and in-repo docs stay in Markdown/plain text.
- Prefer streamlined tables/formats with only the required columns over exhaustive ones.

## AI Usage & Code Attribution (Required — course policy)

Per the CS673 Project Description, **every source file must carry an AI-usage header**, and any function/class with significant AI contribution needs its own annotation block. This applies regardless of which AI tool was used (Claude Code included). Apply this automatically when generating or substantially modifying code in this repo.

**File-level header — required at the top of every source file:**

```javascript
// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~<XX>%
// AI-Assisted Areas: <e.g. route scaffolding, schema, initial UI>
// Human Contributions: <e.g. business logic, validation, security checks>
// Notes: <how AI output was reviewed/modified/tested>
```

If a file has no meaningful AI contribution, use:

```javascript
// No AI Contribution
```

**Function/class-level block — required when AI contribution to that unit is significant:**

```javascript
// AI-ASSISTED: YES
// Tool: Claude Code
// Prompt Summary: "<one-line summary of what was asked>"
// AI Contribution: <e.g. Initial draft (~70%)>
// Modifications:
// - <what the student changed>
// - <what the student changed>
// Verification:
// - <e.g. Unit tests (fileName.test.js)>
// - <e.g. Manual testing via Postman>
// Confidence: <High/Medium/Low>
```

Rules:

- Minor AI use (autocomplete, syntax fixes) does not need a full block.
- Every annotation must stay consistent with the central AI Usage Log (ProgressReport sheet) and Git commit tags (`[AI]`, `[HUMAN]`, `[HYBRID]`).
- AI usage is graded as 15% of the project grade — annotations should be genuinely accurate, not pro forma.

## Git Commit Convention

Tag every commit with its contribution type:

```
[AI] Generate initial CRUD routes for asset inventory
[HUMAN] Add input validation and error handling to asset routes
[HYBRID] Refactor AI-generated schema, add indexes and validation
```
