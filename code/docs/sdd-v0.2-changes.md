# SDD v0.2 change set: resolving the open design decisions (SDD Section 10.1)

|                 |                                                                                                                            |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **Status**      | **DRAFT for team review.** OD-5 and OD-7 are marked **[CONFIRM AT MEETING]**; nothing here is final until the team agrees. |
| **Applies to**  | The SafeDrop Software Design Document, version 0.1 (9/16/2026) to version 0.2                                              |
| **Refs**        | SDD Section 10.1; the ticket "SDD open design decisions"                                                                   |
| **Decides who** | The SDD's design sections are owned per OD-8 (Team Lead to decide). The Team Lead ratifies this change set.                |

## What this file is

The SDD is a Word/Google document and is **not in this repository**, so it cannot be edited by pull request. This
file is a **change set**: every edit the SDD needs, written so it can be pasted in, together with the evidence for
each decision. It is not a second copy of the SDD. **Once the edits are applied to the SDD, delete this file** so
the two cannot drift.

Where a decision is already implemented in merged code, the evidence is cited so reviewers can check it. Where it is
a choice the team has not made, it is marked as a proposal.

## 1. Summary

| OD   | New status                                                                                                               | Basis                                                                                                         | Needs the meeting?         |
| :--- | :----------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ | :------------------------- |
| OD-1 | **Decided: Option A (Vercel proxy)**                                                                                     | Implemented and merged                                                                                        | No, recording only         |
| OD-2 | **Decided: audit inside the service transaction**                                                                        | Implemented, merged and tested                                                                                | No, recording only         |
| OD-6 | **Decided: Mongoose, Zod, Helmet, express-rate-limit**                                                                   | Implemented, merged and in use                                                                                | No, recording only         |
| OD-7 | **Decided: Atlas free tier plus a scheduled export job** [CONFIRM AT MEETING]                                            | Matches the SDD recommendation and what staging runs on. **Decide first**: SCRUM-125 and SCRUM-127 wait on it | **Yes**                    |
| OD-5 | **Decided: Docker for local development and CI parity; Render deploys the API from the Dockerfile** [CONFIRM AT MEETING] | Matches what the README and CI already do                                                                     | **Yes**                    |
| OD-3 | Suggested: **Decided** (not in the ticket)                                                                               | Implemented; the ticket for invitations cites it                                                              | Recommended: quick confirm |
| OD-4 | Unchanged: needs team confirmation                                                                                       | Code implements the matrix as proposed; SCRUM-120 settles it                                                  | Yes (Requirements lead)    |
| OD-8 | Unchanged: Open                                                                                                          | Team Lead to decide                                                                                           | Yes                        |

## 2. Evidence

### OD-1: cookies across domains (Option A)

- `code/frontend/vercel.json` rewrites `/api/(.*)` to the Render API and everything else to `/index.html`, so the
  browser only ever talks to the Vercel origin. In development the Vite dev server proxies `/api/*` the same way.
- Cookies are first-party and set `HttpOnly`, `Secure` (from `COOKIE_SECURE`) and **`SameSite=Lax`**
  (`code/backend/src/utils/tokens.js`), which is what Option A was chosen to allow.
- State-changing requests must be `application/json` and pass an `Origin`/Referer/Fetch-Metadata check
  (`code/backend/src/middleware/security.js`); CORS remains as the SDD says, because the Render URL is still
  directly reachable.
- The code cites "OD-1 Option A" in `cors.js`, `api.js` and `vite.config.js`, and the README documents the proxy.

### OD-2: where the audit entry is written

- Every service that changes state calls `recordAudit(..., { session })` inside `withTransaction`. Examples:
  organisation creation, adding a user, changing a role, and approving or denying a request.
- Tests prove the guarantee rather than assume it: when the audit write is made to fail, the organisation, the user
  or the role change is rolled back (`organizations.test.js`, `users.test.js`).
- The audit repository exposes only `append` and `query`, and the model refuses every Mongoose update or delete.

### OD-6: libraries

- `code/backend/package.json` lists `mongoose`, `zod`, `helmet` and `express-rate-limit`. There is no Joi.
- Zod validates every route's params, query and body (`validate.js`, `schemas.js`); `helmet` sets the security
  headers; `express-rate-limit` guards the authentication routes; Mongoose runs with `sanitizeFilter` on.

### OD-7: Atlas cluster tier (checked against MongoDB's documentation)

What the Atlas documentation says about **Free** clusters
([Atlas Free and Shared Cluster Limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/),
[Configure Custom Database Roles](https://www.mongodb.com/docs/atlas/security-add-mongodb-roles/)):

| Need                                        | Free tier                                                                                                                                                                        | Consequence                                                        |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| Insert-only audit role (SCRUM-125, SDD 6.6) | **Supported.** Custom database roles are not restricted on Free; role changes just take up to 30 seconds to deploy. A role can grant only `find` and `insert` on one collection. | SCRUM-125 does **not** need a paid tier.                           |
| Backups (SCRUM-127, NFR-3)                  | **Not supported.** "You can't enable backups on Free clusters." MongoDB suggests `mongodump`/`mongorestore` instead.                                                             | SCRUM-127 needs a scheduled export job, as the SDD recommends.     |
| Sharding                                    | **Not supported** on Free clusters.                                                                                                                                              | Already stated in SDD 2.3.3; `orgId` stays the intended shard key. |
| Transactions (OD-2)                         | Not addressed by those pages, but staging already runs the app's transactions on the Atlas free tier.                                                                            | Works in practice; the README documents it as staging's database.  |

The README says staging uses "MongoDB Atlas (free tier)", so the recommendation is already what the team runs.
**These are documentation claims: confirm in the Atlas console before relying on them for SCRUM-125.**

### OD-5: Docker beyond local development

- `docker-compose.yml` runs the local stack (a MongoDB replica set, the API and the SPA).
- CI has a `docker` job that builds **both** images (`.github/workflows/ci.yml`), and the deploy jobs `need` it.
- The README states that Render "rebuilds the API from `code/backend/Dockerfile`" and that Vercel builds the SPA from
  `code/frontend`. So the second option in the SDD (Render also deploys from the Dockerfile) is what staging does.
- This is broader than the SDD's recommendation (local development and CI parity only), so it is a real decision
  and belongs to the meeting. The person who wrote the README's deployment section should confirm it is intended.

### OD-3 (suggested addition): account and membership model

- Email is unique **per organisation** (`users.orgId_email_unique`); the same address can exist in two
  organisations as two accounts. Login takes the organisation slug, email and password.
- A user belongs to exactly one organisation (one `orgId`).
- New members are added by an Org Admin, not by self-registration. Iteration 1 has no email service, so the admin
  sets the member's initial password and shares it out of band; email delivery is deferred to Iteration 2 alongside
  Forgotten Password (SCRUM-22). See `doc/data-model.md` for the schema if that PR has merged.

### OD-4: not changed

`code/backend/src/utils/permissions.js` implements the Section 6.4 matrix exactly as proposed, including Approver
and Org Admin holding the checkout/return handoff (`requests:handoff`), and a test pins it against a copy of the
table. So the code follows the proposal, but the ticket leaves the decision to SCRUM-120 and the Requirements lead.

## 3. Revision history

Add a row to the table on the SDD's cover:

| Version | Author   | Date   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :------ | :------- | :----- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2     | [author] | [date] | Recorded design decisions in Section 10.1. OD-1 (Option A, Vercel proxy), OD-2 (audit entry written inside the service transaction) and OD-6 (Mongoose, Zod, Helmet, express-rate-limit) marked Decided to match the merged code. OD-5 (Docker role) and OD-7 (Atlas tier) decided at the team meeting of [date]: [outcomes]. OD-3 marked Decided. Sections 2.1, 2.2, 2.3.3, 2.3.4, 2.4, 2.5, 6.2, 6.3, 6.5, 6.6 and 6.7 updated accordingly. |

## 4. Section 10.1: replacement table

Replace the table's Recommendation, Affects and Status cells as follows. Rows OD-4 and OD-8 are unchanged.

| ID   | Decision needed (unchanged)                                     | Affects           | Status                                                                                                                                                                                                                                                                                 |
| :--- | :-------------------------------------------------------------- | :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-1 | How the SPA and API share authentication cookies across domains | 2.1, 2.4, 6.3     | **Decided: Option A (Vercel proxy).** Implemented via a Vercel rewrite; cookies are first-party and `SameSite=Lax`. Option B remains the upgrade path if a domain is acquired.                                                                                                         |
| OD-2 | Where the audit entry is written                                | 2.5, 6.6          | **Decided: inside the service transaction.** Implemented; the audit write and the state change commit or roll back together, and tests prove the rollback.                                                                                                                             |
| OD-3 | Account and membership model                                    | 6.2, 6.4, 3 and 5 | **Decided.** Email is unique per organisation; one user belongs to one organisation; members are added by an Org Admin (no self-registration). In Iteration 1 the admin sets the initial password and shares it out of band; email is deferred to Iteration 2 with Forgotten Password. |
| OD-4 | Final Iteration 1 permission matrix                             | 6.4               | Needs team confirmation. Implemented as proposed in 6.4; to be confirmed against the user stories (SCRUM-120).                                                                                                                                                                         |
| OD-5 | Docker's role beyond local development                          | 2.2, 2.3.4        | **Decided: [CONFIRM AT MEETING].** Docker Compose for local development; CI builds both images for parity; Render deploys the API from `code/backend/Dockerfile`; the SPA deploys to Vercel from source.                                                                               |
| OD-6 | Library selections                                              | 2.2, 6.5, 6.7     | **Decided:** Mongoose (ODM); Zod (validation, one library for the whole team; Joi not used); Helmet (security headers); express-rate-limit (rate limiting).                                                                                                                            |
| OD-7 | Atlas cluster tier                                              | 2.3.3, 6.6        | **Decided: [CONFIRM AT MEETING].** Atlas free tier, plus a scheduled `mongodump` export job to meet the daily backup target in NFR-3. The free tier supports the insert-only audit role (SCRUM-125); it does not support Atlas backups or sharding.                                    |
| OD-8 | Ownership of this document's design sections                    | Entire document   | Open. Team Lead to decide.                                                                                                                                                                                                                                                             |

## 5. Section edits

Each block is **find, then replace**. Text not shown is unchanged.

### 2.1 Architectural Overview

- **Find:** `that trade-off is analyzed in Section 6.3 (OD-1).`
- **Replace:** `that trade-off is analyzed, and resolved in favour of a same-origin proxy, in Section 6.3 (OD-1).`

### 2.2 Frameworks and Technologies

- **Find (Data access row):** `Mongoose ODM (proposed, OD-6)`
- **Replace:** `Mongoose ODM (OD-6)`
- **Find (Containers row, Role column):** `Reproducible local environment with API and MongoDB containers (deployment role: OD-5)`
- **Replace:** `Reproducible local environment (API, SPA and a MongoDB replica set); CI builds both images for parity; Render deploys the API from its Dockerfile (OD-5)`
- **Add these rows after the Backend row:**

| Concern            | Technology                 | Role in SafeDrop                                                                         |
| :----------------- | :------------------------- | :--------------------------------------------------------------------------------------- |
| Request validation | Zod                        | Schema for every route's path, query and body parameters; unknown fields rejected (OD-6) |
| HTTP security      | Helmet, express-rate-limit | Security headers including HSTS; rate limiting on the authentication routes (OD-6)       |

### 2.3.3 Database (MongoDB Atlas)

- **Find:** `Sharding is not part of the current deployment, however, since Atlas does not offer it on free or shared cluster tiers (OD-7).`
- **Replace:** `Sharding is not part of the current deployment, however, because the team runs on the Atlas free tier (OD-7), which does not offer it. The free tier also has no built-in backups, so a scheduled database export job provides the daily backup required by NFR-3.`

### 2.3.4 Environments and Delivery Pipeline

- **Add after the environments table:** `The API is deployed to Render from code/backend/Dockerfile and the SPA to Vercel from source (OD-5). The same Dockerfile is built in CI on every push and pull request, so a change that breaks the image fails before it merges.`
- **Find:** `Every push and pull request runs linting, unit tests, CodeQL, and npm audit in GitHub Actions.`
- **Replace:** `Every push and pull request runs linting, formatting checks, unit tests, CodeQL, npm audit and a Docker build of both images in GitHub Actions.`

### 2.4 Component Interfaces and Dependencies

- **Find (SafeDrop REST API row, Notes):** `Cookie and domain strategy: OD-1`
- **Replace:** `Cookies are first-party through a Vercel proxy (OD-1, Option A)`

### 2.5 Request Processing Pipeline

- **Find:** `The team should confirm this change.`
- **Replace:** `The team confirmed this change (OD-2), and it is implemented: every service writes the audit entry inside the same transaction as the state change.`

### 6.2 Authentication

- **Find:** `How email addresses map to organizations is an open decision (OD-3).`
- **Replace:** `Login takes the organization's slug together with the email address, because email is unique per organization rather than across SafeDrop (OD-3).`

### 6.3 Session Cookies Across Domains (OD-1)

- **Find:** `Recommendation. Option A for Iteration 1, moving to Option B if the team acquires a domain.`
- **Replace:** `Decision. Option A for Iteration 1: the SPA calls /api/* on its own origin and a Vercel rewrite forwards those requests to Render, so cookies are first-party and SameSite=Lax applies. The team will move to Option B if it acquires a domain.`
- The rest of the paragraph (JSON-only bodies and the Origin check) is unchanged and is implemented.

### 6.5 Input Validation and Output Encoding

- **Find:** `The validation library is still to be selected (OD-6).`
- **Replace:** `Validation uses Zod (OD-6), one library for the whole team.`

### 6.6 Audit Log Integrity

- **Find:** `This replaces the Iteration 0 middleware approach (OD-2).`
- **Replace:** `This replaces the Iteration 0 middleware approach (OD-2, decided).`
- **Add to the Database-layer immutability paragraph:** `The team runs on the Atlas free tier (OD-7), which supports custom database roles, so the insert-only role does not require a paid tier.` **[CONFIRM AT MEETING, and verify in the Atlas console.]**

### 6.7 Transport Security and HTTP Headers

- **Find:** `are applied by middleware such as Helmet (OD-6) [8].`
- **Replace:** `are applied by the Helmet middleware (OD-6) [8].`

## 6. AI usage log

Add a row to the SDD's AI usage log:

| Section                                                         | Who    | AI contribution (%)                      | Description                                                                                                                            | Verified by |
| :-------------------------------------------------------------- | :----- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :---------- |
| 2.1, 2.2, 2.3.3, 2.3.4, 2.4, 2.5, 6.2, 6.3, 6.5, 6.6, 6.7, 10.1 | [name] | [percent; Claude Code drafted the edits] | Claude Code compared the open decisions with the merged code and the Atlas documentation and drafted the Status text and section edits | [reviewer]  |

## 7. Where the SDD and the code disagree (noticed, not changed)

These are outside the ticket, so no edit is proposed. They are worth a look when the SDD is next revised:

- **Deployment path (2.3.4):** staging is deployed by CI mirroring `main` to a second repository that Render and
  Vercel watch, not by those platforms watching this repository. The production deploy job is still a placeholder.
- **Logout (6.2):** the SDD says logout _deletes_ the refresh-token record; the code _revokes_ the session (marks it
  revoked) and the database's expiry removes the row later.
- **Stale roles (6.2):** the SDD says high-impact administrative actions re-read the actor's role from the database.
  That is true of user management, but approving or denying a request, and recording checkout and return, trust the
  role in the token, so a demoted approver keeps that authority for up to 15 minutes.
- **Insert-only audit role (6.6):** the SDD describes a database-level insert-only role. It is not implemented yet
  (SCRUM-125); only the application-level protections exist.
- **Audit actions (6.6):** the SDD's list of `action` values is introduced with "for example". The code also has
  `USER_INVITED` and `ORG_CREATED`.
