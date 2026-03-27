# == Build stage ==============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install backend dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Compile backend TypeScript -> dist/ using esbuild (fast, low memory)
# Type checking is validated separately by the CI test suite
COPY src/ ./src/
COPY build-esbuild.js ./
RUN npm run build:docker

# Build React frontend
WORKDIR /app/src/web
COPY src/web/package.json src/web/package-lock.json* ./
RUN npm ci --ignore-scripts
RUN npm run build

# == Runtime stage =============================================================
FROM node:20-alpine

WORKDIR /app

# Production Node dependencies only (knex included for migrations)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Compiled backend
COPY --from=builder /app/dist ./dist

# Compiled frontend served as static files from dist/web/dist
COPY --from=builder /app/src/web/dist ./dist/web/dist

# Plain-JS startup script (no TypeScript runtime needed)
COPY startup.js ./

# Chain files directory (mount as volume in production)
RUN mkdir -p /data/chains && chown -R node:node /data/chains

# OAuth client store — written by the MCP server, must be writable by the node user
RUN mkdir -p /app/data && chown -R node:node /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV CHAINS_DIR=/data/chains

USER node
EXPOSE 3000

# Runs migrations -> seeds -> starts dist/server.js
CMD ["node", "startup.js"]
