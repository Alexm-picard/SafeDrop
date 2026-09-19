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
- Backend: <http://localhost:4000> (`/health` is a public liveness probe).
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