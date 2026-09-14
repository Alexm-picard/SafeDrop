# AI-USAGE SUMMARY 
# Tools: Claude Code
# Overall AI Contribution: ~100% 
# AI-Assisted Areas: Initial docker-compose setup
#Notes: AI-generated code was reviewed and tested prior to commit

FROM node:24-alpine

WORKDIR /app

# Install dependencies first so this layer is cached between code changes
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5173

# --host lets the Vite dev server accept connections from outside the container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
