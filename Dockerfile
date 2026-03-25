# Stage 1: Build the reporter workflow JSON
FROM node:20-alpine AS workflow-builder
WORKDIR /app
COPY package*.json ./
COPY workflow/ ./workflow/
RUN npm ci --ignore-scripts
RUN npm run build:workflow

# Stage 2: Build the React client
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
COPY --from=workflow-builder /app/client/public/reporter-workflow.json ./public/reporter-workflow.json
RUN npm run build

# Stage 3: Build the server (TypeScript)
FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Stage 4: Production image
FROM node:20-alpine
WORKDIR /app/server

# Install production dependencies only
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy compiled server from builder
COPY --from=server-builder /app/server/dist ./dist

# Copy migration files
COPY server/migrate.js ./migrate.js
COPY server/migrations ./migrations

# Copy built client to public directory
COPY --from=client-builder /app/client/dist ./public

# Copy entrypoint
COPY docker-entrypoint.sh /app/server/docker-entrypoint.sh
RUN chmod +x /app/server/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD sh -c 'wget --spider -q http://localhost:${PORT:-3000}/health || exit 1'

ENTRYPOINT ["./docker-entrypoint.sh"]
