# SafeDrop

## Overview
This is an organizational inventory management/checkout service. The motivation behind this project is to provide organizations (whether it be corporations, educational institutions, etc.) with a centralized, easy-to-navigate interface that can be used to facilitate authorized checkouts of the organization’s physical assets/equipment to its members while maintaining detailed audit logs about every interaction involved in that process (requests, approvals, checkouts, returns – a full history for every individual asset). 

## Purpose
The goal is to create a full-stack web application that will allow organizations to create their own inventory portals, with an interface allowing organization members to request and check out equipment, as well as an admin dashboard for managing the inventory and viewing the audit log.

## Team Members
Alexa Stein - Team Lead  
Amber Rastella - Security  
Alex Picard - Configuration  
Mateus Silva - Requirements  
Orelmis Toribio - QA  

## Tech Stack

| Component | Tech Stack |
| :--------- | :---------- |
|Frontend | React, JavaScript |
|Backend | ExpressJS,  Node.js |
|DBMS | MongoDB Atlas |
|Version Control| Git/Github |
|Container | Docker, Docker Compose |
|AI | Microsoft Foundry |
|Project Management | Jira |
|CI/CD Tools | GitHub Actions |
|SAST | GitHub CodeQL |
|DAST | OWASP ZAP |
|Hosting | Render, Vercel |

## Prerequisites

- Node.js 20 or newer (`node --version` to check)
- npm (comes with Node)
- Git

## First-time setup

1. Clone the repo and enter the project folder:

```bash
git clone https://github.com/BUMETCS673/CS673OLF26P3.git
cd CS673OLF26P3
cp .env.example .env        # optional for local dev: every variable has a dev-only default in docker-compose.yml
docker compose up --build   # mongo (replica set) + mongo-init + backend (runs migrations, then dev server) + frontend
```

- Frontend: <http://localhost:5173> — the first screen is the login page; use **Create an organization** to bootstrap the first admin.
- Backend: <http://localhost:4000> (`/health` is a public probe: 200 when the API and its database are up, 503 when the database is unreachable).
- Mongo from the host: `mongodb://localhost:27017/safedrop?replicaSet=rs0&directConnection=true`.

Useful variants:

```bash
docker compose up --build -V   # also renews node_modules volumes: run this after anyone adds a dependency
docker compose down            # stop, keep the database volume
docker compose down -v         # stop and wipe the database
docker compose logs -f backend
docker compose exec backend npm run migrate:status
```

## Quick start (without Docker)

Prerequisites: Node.js 22 (`.nvmrc`), npm 10, and a MongoDB **replica set** (transactions need one). The easiest replica set is still Compose: `docker compose up mongo mongo-init`.

```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
```

   Fill in the values. Ask the team channel for the shared dev keys. Never commit `.env` files.

4. Start both servers:

```bash
   npm run dev
```

5. Verify:
   - Frontend: http://localhost:5173
   - Backend: http://localhost:4000

## Running after the first time

From the `code/` folder:
```bash
git pull
npm run dev
```

If someone added a new dependency since your last pull, run `npm run install:all` again before `npm run dev`. A `Cannot find module` error is the usual sign you need to.

## Scripts
| Command               | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `npm run dev`         | Starts backend and frontend together              |
| `npm run install:all` | Installs dependencies in root, backend, frontend  |
| `npm run dev --prefix backend`  | Backend only                            |
| `npm run dev --prefix frontend` | Frontend only                           |

## Troubleshooting

- **Port already in use:** something else is on 4000 or 5173. Kill it with `lsof -ti:4000 | xargs kill` (swap the port as needed).
- **`Cannot use import statement outside a module`:** `backend/package.json` must have `"type": "module"`.
- **Frontend can't reach backend:** make sure the backend is running and check the Vite proxy in `frontend/vite.config.ts`.


## Seed dev data

`npm run seed` (from `code/backend`, database already running) creates two demo organizations,
each with 3 role users, 3 assets (laptop/camera/projector) with units across every status
(incl. retired), and one pending checkout request.

| Org | Slug | Admin | Approver | Member |
|---|---|---|---|---|
| Org A (Dev) | `org-a` | admin@a.test | approver@a.test | member@a.test |
| Org B (Dev) | `org-b` | admin@b.test | approver@b.test | member@b.test |

Shared password for every seeded user: `Correct-Horse-Battery-9`

**Destructive every time it runs.** If `org-a`/`org-b` already exist, running `npm run seed` again
drops and recreates them from scratch — no flag or confirmation needed. Refuses entirely when
`NODE_ENV=production`.

**`MONGODB_URI` must be set wherever you run this — inside the container or on your host machine.**

## Staging

| | URL |
|---|---|
| App (Vercel) | <https://safe-drop-five.vercel.app> |
| API (Render) | <https://safedrop-ony6.onrender.com> (`/health` is the probe) |

**How a change gets there.** Merge to `main` in this repository. CI runs lint, format, tests, the
dependency audit and both Docker builds; if all pass, the `deploy-staging` job force-pushes `main`
to [`Alexm-picard/SafeDrop`](https://github.com/Alexm-picard/SafeDrop), which Render and Vercel are
connected to. Render then rebuilds the API from `code/backend/Dockerfile` and Vercel rebuilds the
app from `code/frontend`. SafeDrop is only a mirror: anything committed to it directly is
overwritten by the next merge here. Vercel labels these builds "Production"; for this project they
are staging. Nothing deploys to production yet (`deploy-production` in CI is a placeholder).

The app calls `/api/*` on its own origin and `code/frontend/vercel.json` forwards those requests to
the Render API, so the session cookies stay first-party (SDD §6.3).

**Render environment.** Set in the Render dashboard, never committed:

| Variable | Staging value |
|---|---|
| `NODE_ENV` | `production` (set by the Dockerfile) |
| `MONGODB_URI` | Atlas connection string (secret) |
| `JWT_ACCESS_SECRET` | secret, at least 32 characters |
| `CORS_ORIGINS` | `https://safe-drop-five.vercel.app` |
| `APP_BASE_URL` | `https://safe-drop-five.vercel.app` (base of invitation links) |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `1` per SDD §6.8, which is also the production default when unset (see the known issue below) |

In production mode the API refuses to start without `COOKIE_SECURE=true`, a non-empty
`CORS_ORIGINS` and an `https://` `APP_BASE_URL`, so a missing value fails the deploy rather than
serving insecurely. The catch is that Render then keeps the previous version running, so staging
quietly stays on old code. **A PR that adds a required variable must have it set in Render before
it merges**, and should add it to this table.

**Database.** MongoDB Atlas (free tier). The container does not run migrations: after merging a
change that adds one, run `npm run migrate` from `code/backend` with `MONGODB_URI` set to the Atlas
connection string.

**Cold starts.** The Render free tier stops the API after 15 minutes without traffic, and the next
request waits while it starts again (about 20 seconds when measured).

**Known issue: login rate limiting on staging.** On Render the API does not see the caller's IP.
Requests from a single client land in several rate-limit buckets that other clients share, which
means it is keying on a few Render proxy addresses. The failed-login limit (20 per 15 minutes) is
therefore shared by everyone rather than applied per client, so enough failed logins from anyone
produce 429s for everyone. Do not test the rate limiter against staging until this is fixed.