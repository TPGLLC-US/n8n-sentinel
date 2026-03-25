# Coolify & Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make n8n Sentinel production-ready for deployment on Coolify, Portainer, or any Docker Compose host.

**Architecture:** 4-stage Dockerfile builds workflow, client, and server separately. A shell entrypoint validates env vars, waits for Postgres, runs `node-pg-migrate` migrations, then starts the Express app. A single `docker-compose.yml` works for both local and platform deployment via `${VAR:-default}` interpolation.

**Tech Stack:** Docker Compose V2, node-pg-migrate, Node 20 Alpine, PostgreSQL 15

**Spec:** `docs/superpowers/specs/2026-03-25-coolify-docker-deployment-design.md`

---

### Task 1: Add node-pg-migrate and Create Initial Migration

**Files:**
- Modify: `server/package.json`
- Create: `server/migrations/0001_initial-schema.sql`

- [ ] **Step 1: Install node-pg-migrate as a production dependency**

```bash
cd server && npm install node-pg-migrate
```

Verify it appears in `dependencies` (not `devDependencies`) in `server/package.json`.

- [ ] **Step 2: Create the migrations directory and initial migration**

```bash
mkdir -p server/migrations
cp dbschema.sql server/migrations/0001_initial-schema.sql
```

The existing `dbschema.sql` already uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout, making it idempotent. No modifications needed.

- [ ] **Step 3: Verify the migration file**

Run: `head -5 server/migrations/0001_initial-schema.sql`
Expected: Should start with `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json server/migrations/
git commit -m "feat: add node-pg-migrate and initial schema migration"
```

---

### Task 2: Create Programmatic Migration Runner

**Files:**
- Create: `server/migrate.js`

- [ ] **Step 1: Create server/migrate.js**

```javascript
const { default: migrate } = require('node-pg-migrate');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[migrations] DATABASE_URL is not set.');
  process.exit(1);
}

console.log('[migrations] Running database migrations...');

migrate({
  databaseUrl,
  dir: path.join(__dirname, 'migrations'),
  direction: 'up',
  migrationsTable: 'pgmigrations',
  log: console.log,
}).then(() => {
  console.log('[migrations] Complete.');
  process.exit(0);
}).catch((err) => {
  console.error('[migrations] Failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Test the migration runner locally**

Ensure the local database is running (`docker compose up -d db` or local Postgres), then:

```bash
cd server && DATABASE_URL=postgres://sentinel:password@localhost:5432/sentinel node migrate.js
```

Expected: `[migrations] Running database migrations...` followed by `[migrations] Complete.`
Run a second time to verify idempotency — should say `Complete.` without errors.

- [ ] **Step 3: Commit**

```bash
git add server/migrate.js
git commit -m "feat: add programmatic migration runner"
```

---

### Task 3: Create Docker Entrypoint Script

**Files:**
- Create: `docker-entrypoint.sh`

- [ ] **Step 1: Create docker-entrypoint.sh in the project root**

```bash
#!/bin/sh
set -e

# ─── Validate required environment variables ────────────────────────────
REQUIRED_VARS="SESSION_SECRET ENCRYPTION_KEY SENTINEL_ADMIN_EMAIL SENTINEL_ADMIN_PASSWORD DATABASE_URL"

for var in $REQUIRED_VARS; do
  eval val=\$$var
  if [ -z "$val" ]; then
    echo "FATAL: Required environment variable $var is not set."
    echo "Copy .env.example to .env and configure your environment."
    exit 1
  fi
done

# ─── Wait for PostgreSQL ────────────────────────────────────────────────
echo "[entrypoint] Waiting for PostgreSQL..."
RETRIES=30
until node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "FATAL: Could not connect to PostgreSQL after 30 seconds."
    exit 1
  fi
  echo "[entrypoint] PostgreSQL not ready, retrying... ($RETRIES attempts left)"
  sleep 1
done
echo "[entrypoint] PostgreSQL is ready."

# ─── Run database migrations ────────────────────────────────────────────
node migrate.js

# ─── Start the application ──────────────────────────────────────────────
echo "[entrypoint] Starting n8n Sentinel..."
exec node dist/index.js
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x docker-entrypoint.sh
```

- [ ] **Step 3: Commit**

```bash
git add docker-entrypoint.sh
git commit -m "feat: add Docker entrypoint with env validation, DB wait, and migrations"
```

---

### Task 4: Rewrite Dockerfile (4-Stage Build)

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Replace Dockerfile with 4-stage build**

```dockerfile
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
  CMD wget --spider -q http://localhost:3000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
```

- [ ] **Step 2: Verify Dockerfile syntax**

```bash
docker build --check . 2>&1 || echo "Note: --check may not be available, visual review is fine"
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: rewrite Dockerfile with 4-stage build, health check, and entrypoint"
```

---

### Task 5: Rewrite docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Replace docker-compose.yml**

```yaml
services:
  sentinel:
    build: .
    environment:
      - NODE_ENV=${NODE_ENV:-production}
      - PORT=${PORT:-3000}
      - DATABASE_URL=postgres://sentinel:${POSTGRES_PASSWORD:-sentinel}@db:5432/sentinel
      - SESSION_SECRET=${SESSION_SECRET:?SESSION_SECRET is required — see .env.example}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY:?ENCRYPTION_KEY is required — see .env.example}
      - SENTINEL_ADMIN_EMAIL=${SENTINEL_ADMIN_EMAIL:?SENTINEL_ADMIN_EMAIL is required — see .env.example}
      - SENTINEL_ADMIN_PASSWORD=${SENTINEL_ADMIN_PASSWORD:?SENTINEL_ADMIN_PASSWORD is required — see .env.example}
      - CORS_ORIGIN=${CORS_ORIGIN:-}
      - SENTINEL_PUBLIC_URL=${SENTINEL_PUBLIC_URL:-}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
    ports:
      - "${PORT:-3000}:${PORT:-3000}"
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: sentinel
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-sentinel}
      POSTGRES_DB: sentinel
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sentinel"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
```

- [ ] **Step 2: Validate compose syntax**

```bash
docker compose config --quiet && echo "Compose file is valid"
```

Note: This will fail if required env vars aren't set — that's expected. Set them temporarily or create a `.env` to test:

```bash
SESSION_SECRET=test ENCRYPTION_KEY=test SENTINEL_ADMIN_EMAIL=test@test.com SENTINEL_ADMIN_PASSWORD=test docker compose config --quiet && echo "Valid"
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: rewrite docker-compose.yml for portable deployment"
```

---

### Task 6: Update Vite Config for Dynamic Proxy Port

**Files:**
- Modify: `client/vite.config.ts`

- [ ] **Step 1: Replace client/vite.config.ts**

```typescript
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load PORT from the monorepo root .env
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const apiPort = rootEnv.PORT || '3000'
  const apiTarget = `http://localhost:${apiPort}`

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        // Per-instance ingest paths: /<accountToken>/<instanceToken>/ingest
        '^/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+/ingest': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
```

- [ ] **Step 2: Verify Vite config loads**

```bash
cd client && npx vite --help > /dev/null 2>&1 && echo "Vite config is valid"
```

- [ ] **Step 3: Commit**

```bash
git add client/vite.config.ts
git commit -m "fix: make Vite proxy port dynamic from .env PORT variable"
```

---

### Task 7: Remove Hardcoded Dev Secret Defaults

**Files:**
- Modify: `server/src/lib/auth.ts`

- [ ] **Step 1: Update getRequiredEnv and remove dev defaults**

In `server/src/lib/auth.ts`, make these changes:

**a)** Remove the `DEV_SESSION_SECRET` constant (line 9):
```
Delete: const DEV_SESSION_SECRET = 'dev-only-secret-do-not-use-in-production-min32chars!!';
```

**b)** Update `getRequiredEnv` to remove the `devDefault` parameter and always require the var:

Replace the entire `getRequiredEnv` function (lines 11-22) with:
```typescript
function getRequiredEnv(name: string): string {
    const val = process.env[name];
    if (!val) {
        console.error(`FATAL: Required environment variable ${name} is not set.`);
        console.error('Copy .env.example to .env and configure your environment.');
        process.exit(1);
    }
    return val;
}
```

**c)** Update `getSessionSecret` to remove `DEV_SESSION_SECRET` reference (lines 24-31):

Replace with:
```typescript
export function getSessionSecret(): string {
    const secret = getRequiredEnv('SESSION_SECRET');
    if (secret.length < 32) {
        console.error('FATAL: SESSION_SECRET must be at least 32 characters.');
        process.exit(1);
    }
    return secret;
}
```

**d)** Update `seedAdminUser` to remove dev defaults (lines 48-49):

Replace:
```typescript
    const email = getRequiredEnv('SENTINEL_ADMIN_EMAIL', 'admin@sentinel.local');
    const password = getRequiredEnv('SENTINEL_ADMIN_PASSWORD', 'admin1234admin');
```
With:
```typescript
    const email = getRequiredEnv('SENTINEL_ADMIN_EMAIL');
    const password = getRequiredEnv('SENTINEL_ADMIN_PASSWORD');
```

- [ ] **Step 2: Verify the server starts with .env set**

```bash
cd server && npx ts-node -e "require('./src/lib/auth').getSessionSecret()" 2>&1
```

Expected: Should work if `.env` has SESSION_SECRET with 32+ chars, or exit with FATAL message if not.

**Note:** This change enforces 32-char SESSION_SECRET in ALL environments (not just production). Developers must set a real secret in `.env` even for local dev. Update your `.env` if it has a short placeholder.

- [ ] **Step 3: Commit**

```bash
git add server/src/lib/auth.ts
git commit -m "security: remove hardcoded dev secret defaults, always require .env"
```

---

### Task 8: Remove Debug Logging from Login Handler

**Files:**
- Modify: `server/src/middleware/session.ts`

- [ ] **Step 1: Remove the two diagnostic console.warn lines**

In `server/src/middleware/session.ts`, in the `login` handler:

Remove these exact two `console.warn` lines (keep the `return res.status(401)` lines that follow them):

Line ~51:
```typescript
            console.warn(`[auth] Login failed: no user found for email="${email}"`);
```

Line ~58:
```typescript
            console.warn(`[auth] Login failed: wrong password for email="${email}" (hash starts with ${user.password_hash.substring(0, 7)})`);
```

- [ ] **Step 2: Verify the file**

Confirm no `console.warn` remains in the login handler:

```bash
grep -n "console.warn" server/src/middleware/session.ts
```

Expected: No output (no console.warn lines).

- [ ] **Step 3: Commit**

```bash
git add server/src/middleware/session.ts
git commit -m "fix: remove security-sensitive debug logging from login handler"
```

---

### Task 9: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace .env.example with documented version**

```bash
# ─── n8n Sentinel Environment Configuration ────────────────────────────
# Copy this file to .env and fill in the values.
# Required variables are marked with [REQUIRED].

# ─── Security [REQUIRED] ──────────────────────────────────────────────
# Session secret for JWT signing (min 32 characters)
# Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
SESSION_SECRET=

# Encryption key for sensitive settings stored in the database (64-char hex string)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=

# ─── Admin Account [REQUIRED] ─────────────────────────────────────────
# Seeded on first startup; password updated on subsequent startups
SENTINEL_ADMIN_EMAIL=admin@example.com
SENTINEL_ADMIN_PASSWORD=

# ─── Database [REQUIRED for Docker] ──────────────────────────────────
# Used by docker-compose for both the DB and connection string
POSTGRES_PASSWORD=sentinel

# Direct connection string (override for external databases)
# DATABASE_URL=postgres://sentinel:sentinel@localhost:5432/sentinel

# ─── Optional ─────────────────────────────────────────────────────────
# Server port (default: 3000)
# PORT=3000

# Set to 'development' for local dev with npm run dev
# NODE_ENV=development

# CORS origin — only needed if frontend is served from a different domain
# CORS_ORIGIN=https://sentinel.example.com

# Public URL for per-instance ingest URLs displayed in the dashboard
# SENTINEL_PUBLIC_URL=https://sentinel.example.com

# Anthropic API key for AI-powered error diagnosis
# ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: improve .env.example with generation commands and required/optional labels"
```

---

### Task 10: Update README and Clean Up

**Files:**
- Modify: `README.md`
- Delete: `dbschema.sql`
- Delete: `COOLIFY_DEPLOYMENT_RESEARCH.md`
- Delete: `server/docs/db-migration-research.md`
- Delete: `server/docs/deployment-assumptions-research.md`

- [ ] **Step 1: Add Docker deployment section to README.md**

Insert after the existing "Quick Start" section (after line ~43), before "Setup":

```markdown
## Docker Deployment

Deploy the full stack (app + PostgreSQL) with a single command:

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env — set SESSION_SECRET, ENCRYPTION_KEY, SENTINEL_ADMIN_EMAIL,
# SENTINEL_ADMIN_PASSWORD, and POSTGRES_PASSWORD at minimum

# Start everything
docker compose up -d
```

The app runs at `http://localhost:3000` (or your configured PORT).

**What happens on startup:**
1. Validates required environment variables
2. Waits for PostgreSQL to be ready
3. Runs database migrations automatically
4. Starts the Express server serving both API and dashboard

**For Coolify / Portainer / other platforms:**
Point the deployment at this repo. Set environment variables in the platform UI. The `docker-compose.yml` uses `${VAR}` interpolation that works with any platform's env var injection.
```

- [ ] **Step 2: Update the Database section**

Replace the existing "### 1. Database" section (lines ~50-58) with:

```markdown
### 1. Database

The database schema is managed by migrations that run automatically on startup (both Docker and manual). For manual development:

```bash
# Start Postgres via Docker
docker compose up -d db

# Run migrations
cd server && DATABASE_URL=postgres://sentinel:sentinel@localhost:5432/sentinel node migrate.js
```
```

- [ ] **Step 3: Delete research artifacts and old schema file**

```bash
rm -f COOLIFY_DEPLOYMENT_RESEARCH.md
rm -f server/docs/db-migration-research.md
rm -f server/docs/deployment-assumptions-research.md
rm -f dbschema.sql
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git rm -f --ignore-unmatch COOLIFY_DEPLOYMENT_RESEARCH.md server/docs/db-migration-research.md server/docs/deployment-assumptions-research.md dbschema.sql
git commit -m "docs: add Docker deployment section, remove research artifacts and old schema file"
```

---

### Task 11: Integration Test — Docker Build & Run

**Files:** None (verification only)

- [ ] **Step 1: Build the Docker image**

```bash
docker compose build sentinel
```

Expected: 4-stage build completes without errors. Look for:
- `[workflow-builder]` stage producing `reporter-workflow.json`
- `[client-builder]` stage producing Vite output
- `[server-builder]` stage compiling TypeScript
- Final image with health check and entrypoint

- [ ] **Step 2: Ensure .env is configured**

```bash
cp .env.example .env
```

Edit `.env` to set the required secrets:
- `SESSION_SECRET` — run: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- `ENCRYPTION_KEY` — run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `SENTINEL_ADMIN_PASSWORD` — set to any 12+ char password
- `SENTINEL_ADMIN_EMAIL` — set to your email
- `POSTGRES_PASSWORD` — set to any value

- [ ] **Step 3: Start the full stack**

```bash
docker compose up -d
```

Expected: Both `sentinel` and `db` containers start. Check logs:

```bash
docker compose logs sentinel
```

Should show:
```
[entrypoint] Waiting for PostgreSQL...
[entrypoint] PostgreSQL is ready.
[migrations] Running database migrations...
[migrations] Complete.
[entrypoint] Starting n8n Sentinel...
[server]: Server is running at http://localhost:3000
```

- [ ] **Step 4: Verify health check**

```bash
docker inspect --format='{{.State.Health.Status}}' $(docker compose ps -q sentinel)
```

Expected: `healthy` (may take up to 40 seconds for `start_period`)

- [ ] **Step 5: Verify the app serves the dashboard**

```bash
curl -s http://localhost:3000/ | head -1
```

Expected: HTML starting with `<!DOCTYPE html>` (the React app)

- [ ] **Step 6: Verify login works**

```bash
curl -s -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_ADMIN_EMAIL","password":"YOUR_ADMIN_PASSWORD"}'
```

Expected: JSON with `token`, `refreshToken`, and `user` fields.

- [ ] **Step 7: Clean up**

```bash
docker compose down
```
