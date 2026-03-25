# Coolify & Docker Deployment Design

> **Goal:** Make n8n Sentinel production-ready for deployment on Coolify, Portainer, or any Docker Compose host — with portable configuration, automated database migrations, and secure defaults.

**Date:** 2026-03-25

---

## Context

n8n Sentinel is an open-source monitoring dashboard. It currently has a Dockerfile and docker-compose.yml that work for local development but have several issues for production/platform deployment:

- Dockerfile missing the `build:workflow` step (reporter-workflow.json not included)
- PostgreSQL port exposed publicly
- Database schema initialized via bind mount (won't work on managed platforms)
- Hardcoded dev secret fallbacks in auth code
- Vite proxy port hardcoded (breaks when PORT env var changes)
- No container health check on the app service

## Constraints

- **Portable:** No platform-specific magic vars (Coolify, Railway, etc.). Standard Docker Compose only.
- **Single compose file:** Must work both locally (`docker compose up`) and on platforms via env var injection.
- **Open-source friendly:** Users copy `.env.example`, set secrets, run one command.
- **Node 20 Alpine:** Stay on current LTS, upgrade to 22 in a separate PR.

## Architecture

```
┌──────────────────────────────────┐
│         Docker Compose           │
│                                  │
│  ┌────────────┐  ┌───────────┐  │
│  │  sentinel   │  │  postgres │  │
│  │  (Node 20)  │──│  (v15)    │  │
│  │             │  │           │  │
│  │ Express API │  │ Private   │  │
│  │ + React SPA │  │ (no port) │  │
│  └─────┬──────┘  └───────────┘  │
│        │                         │
│  docker-entrypoint.sh            │
│  1. Validate env vars            │
│  2. Wait for Postgres            │
│  3. Run migrations               │
│  4. exec node dist/index.js      │
└──────────────────────────────────┘
         │
    Traefik / Caddy / Nginx
    (provided by platform)
         │
      Internet
```

---

## 1. Dockerfile (4-Stage Build)

### Current
2 stages: client build → server build. Missing workflow build step. No health check. Installs TypeScript globally.

### Proposed
4 stages:

**Stage 1 — workflow-builder:**
- `COPY package*.json ./` and `COPY workflow/ ./workflow/` (workflow build uses root package.json + workflow/ directory)
- `RUN npm ci`
- `RUN npm run build:workflow` → produces `client/public/reporter-workflow.json`

**Stage 2 — client-builder:**
- Install client dependencies
- Copy workflow output into `client/public/`
- Run `vite build`

**Stage 3 — server-builder:**
- `npm ci` (full install including devDependencies, so `tsc` is available)
- `npm run build` (compiles TypeScript to `dist/`)

**Stage 4 — final:**
- `npm ci --production` (production deps only, including `node-pg-migrate`)
- Copy `dist/` from server-builder stage (compiled JS only, no devDeps)
- Copy client dist to `server/public/`
- Copy `docker-entrypoint.sh` and `server/migrations/`
- `HEALTHCHECK` using `wget --spider -q http://localhost:3000/health`
- `ENTRYPOINT ["./docker-entrypoint.sh"]`

**Note:** `node-pg-migrate` must be in `server/package.json` `dependencies` (not `devDependencies`) because it runs at container startup via `docker-entrypoint.sh`.

### Rationale
- 4 stages keeps build layers cached independently and solves the tsc/devDependency problem
- `wget` is included in Alpine (no need to install `curl`)
- Entrypoint script replaces bare `CMD` to enable migrations and validation

---

## 2. docker-compose.yml

### Changes from current
- Remove `version: '3.8'` (deprecated in Compose V2)
- Remove `env_file: .env` — env vars are now passed explicitly via the `environment:` block using `${VAR}` interpolation, which Compose resolves from `.env` in the same directory automatically
- Remove `ports: "5432:5432"` on Postgres (keep DB private)
- Remove `./dbschema.sql` bind mount (migrations handle schema)
- Add `${VAR:-default}` syntax for all env vars
- Add health check on sentinel service
- Required secrets use `${VAR:?Required}` for fail-fast

### Environment variable strategy

```yaml
sentinel:
  environment:
    - NODE_ENV=${NODE_ENV:-production}
    - PORT=${PORT:-3000}
    - DATABASE_URL=postgres://sentinel:${POSTGRES_PASSWORD:-sentinel}@db:5432/sentinel
    - SESSION_SECRET=${SESSION_SECRET:?SESSION_SECRET is required}
    - ENCRYPTION_KEY=${ENCRYPTION_KEY:?ENCRYPTION_KEY is required}
    - SENTINEL_ADMIN_EMAIL=${SENTINEL_ADMIN_EMAIL:?SENTINEL_ADMIN_EMAIL is required}
    - SENTINEL_ADMIN_PASSWORD=${SENTINEL_ADMIN_PASSWORD:?SENTINEL_ADMIN_PASSWORD is required}
    - CORS_ORIGIN=${CORS_ORIGIN:-}
    - SENTINEL_PUBLIC_URL=${SENTINEL_PUBLIC_URL:-}
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
```

- Required vars fail fast at `docker compose up` time with a clear error
- Optional vars default to empty string
- `POSTGRES_PASSWORD` defaults to `sentinel` for local dev; users override for production
- Platforms (Coolify, Portainer) inject env vars via their UI; they flow through the `${VAR}` syntax

---

## 3. Database Migrations

### Tool
`node-pg-migrate` — Postgres-specific, supports raw SQL files, programmatic API, auto-creates tracking table, runs in transactions.

### Structure
```
server/
  migrations/
    0001_initial-schema.sql    # Content of current dbschema.sql
  migrate.js                    # Programmatic runner for entrypoint
```

### migrate.js

```javascript
const { default: migrate } = require('node-pg-migrate');

migrate({
  databaseUrl: process.env.DATABASE_URL,
  dir: __dirname + '/migrations',
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

### Behavior
- `docker-entrypoint.sh` calls `node migrate.js` before starting the app
- `node-pg-migrate` auto-creates `pgmigrations` table on first run
- Already-applied migrations are skipped
- Existing deployments: the current `dbschema.sql` uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout, so the initial migration is idempotent — safe to run against databases that already have the schema

### Future migrations
New `.sql` files in `server/migrations/` with incrementing prefixes. They run automatically on next deploy.

---

## 4. Entrypoint Script

`docker-entrypoint.sh` — runs before the Node app:

The script must use `set -e` so any failure (env validation, DB connection, migration) aborts startup immediately. `node-pg-migrate` runs each migration in a transaction, so a failed migration rolls back cleanly.

1. **`set -e`** — exit on any error
2. **Validate required env vars** — `SESSION_SECRET`, `ENCRYPTION_KEY`, `SENTINEL_ADMIN_EMAIL`, `SENTINEL_ADMIN_PASSWORD`, `DATABASE_URL`. Exit 1 with a clear message if missing, pointing user to `.env.example`.
3. **Wait for Postgres** — retry connection up to 30 seconds (handles race with `depends_on` health check)
4. **Run migrations** — `node migrate.js` (calls `node-pg-migrate` programmatic API). If migration fails, the transaction rolls back and the container exits.
5. **Start app** — `exec node dist/index.js` (`exec` replaces shell so Node receives SIGTERM for graceful shutdown)

---

## 5. Vite Proxy Port

### Current
Hardcoded proxy target in `client/vite.config.ts` (currently `http://localhost:3786` after a port change during debugging). This breaks whenever the `PORT` env var differs from the hardcoded value.

### Proposed
Use Vite's `loadEnv()` to read `PORT` from the monorepo root `.env`:

```typescript
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const apiPort = rootEnv.PORT || '3000'
  const apiTarget = `http://localhost:${apiPort}`

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '^/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+/ingest': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
```

Only affects development (Vite doesn't run in production Docker).

---

## 6. Remove Hardcoded Dev Secret Defaults

### Current (`server/src/lib/auth.ts`)
```typescript
const DEV_SESSION_SECRET = 'dev-only-secret-do-not-use-in-production-min32chars!!';
getRequiredEnv('SESSION_SECRET', DEV_SESSION_SECRET);
getRequiredEnv('SENTINEL_ADMIN_PASSWORD', 'admin1234admin');
getRequiredEnv('SENTINEL_ADMIN_EMAIL', 'admin@sentinel.local');
```

### Proposed
Remove all dev default arguments from `getRequiredEnv()` calls. The function always requires the env var or exits with a message:

```
FATAL: Required environment variable SESSION_SECRET is not set.
Copy .env.example to .env and configure your environment.
```

The `.env` file (from `.env.example`) provides dev values. No secrets in source code.

---

## 7. Cleanup & Documentation

- **Remove** `COOLIFY_DEPLOYMENT_RESEARCH.md` and `server/docs/db-migration-research.md` (research artifacts)
- **Remove** diagnostic `console.warn` lines in the `login` handler in `server/src/middleware/session.ts` that log `email=` and `hash starts with` (security-sensitive debug output added during debugging)
- **Update `.env.example`** — proper secret generation commands, document required vs optional, minimum lengths
- **Update `README.md`** — add Docker deployment section:
  ```
  cp .env.example .env
  # Edit .env with your secrets
  docker compose up -d
  ```

---

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `Dockerfile` | Modify | 4-stage build, health check, entrypoint |
| `docker-compose.yml` | Modify | Portable config, private DB, env var syntax |
| `docker-entrypoint.sh` | Create | Validate env, wait for DB, run migrations, start app |
| `server/migrate.js` | Create | Programmatic node-pg-migrate runner |
| `server/migrations/0001_initial-schema.sql` | Create | Initial migration from dbschema.sql |
| `server/package.json` | Modify | Add node-pg-migrate dependency |
| `server/src/lib/auth.ts` | Modify | Remove hardcoded dev defaults |
| `server/src/middleware/session.ts` | Modify | Remove debug logging |
| `client/vite.config.ts` | Modify | Dynamic proxy port |
| `.env.example` | Modify | Better documentation, generation commands |
| `README.md` | Modify | Add Docker deployment section |
| `dbschema.sql` | Delete | Replaced by `server/migrations/0001_initial-schema.sql` |
| `COOLIFY_DEPLOYMENT_RESEARCH.md` | Delete | Research artifact |
| `server/docs/db-migration-research.md` | Delete | Research artifact |
| `server/docs/deployment-assumptions-research.md` | Delete | Research artifact |

---

## Out of Scope

- Node 22 upgrade (separate PR)
- Docker Compose profiles (dev tools, monitoring)
- Nginx reverse proxy in compose (platforms provide this)
- Multi-replica / horizontal scaling
- CI/CD pipeline
- Kubernetes / Helm charts
