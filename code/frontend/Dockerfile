# AI-USAGE SUMMARY
# Tools: Claude Code
# Overall AI Contribution: ~90% (skeleton generated from team design documents; original by Alex Picard)
# AI-Assisted Areas: Node 22 base for the Vite dev-server image used by docker-compose
# Human Contributions: pending team review
# Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
#
# Development image only: Vercel builds the production bundle itself (`npm run build`).

FROM node:22-alpine

# Run as the unprivileged `node` user from the start so node_modules (where Vite writes its
# dependency cache) is owned by the runtime user.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

# Install dependencies first so this layer is cached between code changes.
COPY --chown=node:node package*.json ./
RUN npm ci

COPY --chown=node:node . .

EXPOSE 5173

# --host lets the Vite dev server accept connections from outside the container.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
