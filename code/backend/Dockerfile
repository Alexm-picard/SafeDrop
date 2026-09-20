# AI-USAGE SUMMARY
# Tools: Claude Code
# Overall AI Contribution: ~90% (skeleton generated from team design documents; original by Alex Picard)
# AI-Assisted Areas: Node 22 base, production default command, dev override via docker-compose
# Human Contributions: reviewed by Amber Rastella (PR #6, 2026-09-14)
# Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.
#
# Production-shaped image: runtime deps only, `node src/server.js`. docker-compose overrides the
# command with `npm run migrate && npm run dev` and bind-mounts the source for hot reload.

FROM node:22-alpine

ENV NODE_ENV=production
# Run as the unprivileged `node` user from the start so node_modules is owned by the runtime user
# (Compose keeps node_modules in a volume that must stay writable by that user).
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

# Install dependencies first so this layer is cached between code changes.
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .

EXPOSE 4000

CMD ["node", "src/server.js"]
