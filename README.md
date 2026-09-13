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
   git clone <repo-url>
   cd CS673OLF26P3/code
```

2. Install all dependencies (root, backend, and frontend):

```bash
   npm run install:all
```

3. Create environment files by copying the examples:

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
