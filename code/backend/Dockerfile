# AI-USAGE SUMMARY
# Tools: Claude Code
# Overall AI Contribution: ~90% (skeleton generated from team design documents; original by Alex Picard)
# AI-Assisted Areas: Node 22 base, production default command, dev override via docker-compose; the
#   dev stage carrying devDependencies so the test suite runs in the container (Lab 3, SCRUM-141)
# Human Contributions: reviewed by Amber Rastella (PR #6, 2026-09-14); dev stage pending review
# Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.
#
# Two images from one file:
#
#   * `runtime` — runtime dependencies only, `node src/server.js`. What Render deploys.
#   * `dev` — the same, plus devDependencies, so `npm test` works inside the container (Lab 3
#     step 4d: "run your tests inside the container"). docker-compose builds this one and overrides
#     the command with `npm run migrate && npm run dev`, bind-mounting the source for hot reload.
#
# **`runtime` is last on purpose.** `docker build` with no `--target` builds the final stage, so a
# deploy that knows nothing about these stages still gets the lean image rather than one carrying a
# test framework. Only docker-compose asks for `dev` by name.

FROM node:22-alpine AS base

ENV NODE_ENV=production
# Run as the unprivileged `node` user from the start so node_modules is owned by the runtime user
# (Compose keeps node_modules in a volume that must stay writable by that user).
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

# Install dependencies first so this layer is cached between code changes.
COPY --chown=node:node package*.json ./

# --- dev: everything the test suite needs -------------------------------------------------------
FROM base AS dev

# npm omits devDependencies whenever NODE_ENV=production, so the intent is stated twice: the env var
# for npm's own default, and --include=dev so it survives someone changing that var later.
ENV NODE_ENV=development
# mongodb-memory-server downloads a mongod binary when it installs, and MongoDB publishes no build
# for Alpine's C library, so that download fails the image build outright. It is not needed here:
# TEST_MONGODB_URI points the suite at the real `mongo` service instead, which is a genuine replica
# set and so satisfies the transactions the services depend on. See tests/globalSetup.js.
ENV MONGOMS_DISABLE_POSTINSTALL=1
RUN npm ci --include=dev

# Source *and* test code, which is what makes `npm test` in the container possible. .dockerignore
# excludes node_modules, coverage and .env — not tests/.
COPY --chown=node:node . .

EXPOSE 4000
CMD ["node", "src/server.js"]

# --- runtime: the deployable image, and the default target --------------------------------------
FROM base AS runtime

RUN npm ci --omit=dev

COPY --chown=node:node . .

EXPOSE 4000
CMD ["node", "src/server.js"]
