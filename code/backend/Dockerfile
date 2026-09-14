# AI-USAGE SUMMARY 
# Tools: Claude 
# Overall AI Contribution: ~100% 
# AI-Assisted Areas: Initial docker-compose setup
#Notes: AI-generated code was reviewed and tested prior to commit

FROM node:24-alpine

WORKDIR /app

# Install dependencies first so this layer is cached between code changes
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4000

# Dev server: `node --watch src/index.js`
CMD ["npm", "run", "dev"]
