# n8n Sentinel — Architecture Overview

**What it is.** Centralized monitoring dashboard for n8n workflow-automation instances. Express 5 + TypeScript + PostgreSQL server, React 19 + Vite client, Reporter n8n workflow template that users import into their own n8n.

**Top-level layout.**
- `server/` — Express API + scheduler (`server/src/index.ts`).
- `client/` — React SPA (`client/src/App.tsx`).
- `workflow/` — Reporter workflow template + build pipeline.
- `docs/architecture/` — this directory.

**Feature map.**
| Area | Doc | Primary files |
|---|---|---|
| Auth & security | [auth-and-security.md](auth-and-security.md) | `server/src/middleware/session.ts`, `lib/auth.ts`, `services/encryption.ts`, `lib/safe-fetch.ts` |
| Instance management | [instance-management.md](instance-management.md) | `server/src/routes/instances.ts` |
| Reporter workflow | [reporter-workflow.md](reporter-workflow.md) | `workflow/`, `server/src/routes/ingest.ts`, `middleware/auth.ts` |
| AI fix & diagnosis | [ai-fix-and-diagnosis.md](ai-fix-and-diagnosis.md) | `services/ai-fix.ts`, `services/ai-agent.ts`, `services/workflow-utils.ts` |
| Alerts & monitoring | [alerts-and-monitoring.md](alerts-and-monitoring.md) | `services/alerts.ts`, `services/resend.ts` |
| Forecasting | [forecasting.md](forecasting.md) | `services/forecasting.ts` |
| Resources inventory | [resources-inventory.md](resources-inventory.md) | `services/extractor.ts`, `routes/resources.ts` |
| Frontend | [frontend.md](frontend.md) | `client/src/` |

**Request life-cycle (protected API).**
1. Client sends `Authorization: Bearer <jwt>` to `/api/*`.
2. `requireAuth` (`server/src/middleware/session.ts:19`) verifies JWT.
3. Route handler runs, returns JSON.

Protected routers are mounted at `server/src/index.ts:100-108` (`/api/instances`, `/api/metrics`, `/api/resources`, `/api/executions`, `/api/alerts`, `/api/models`, `/api/settings`, `/api/errors`, `/api/reports`).

**Request life-cycle (ingest from reporter workflow).**
1. Reporter posts to `/{accountToken}/{instanceToken}/ingest` with body + `X-Sentinel-Signature` (mounted at `server/src/index.ts:91`).
2. `validateIngestPath` (`server/src/middleware/auth.ts:59`) resolves instance by token.
3. `validateSignature` (`server/src/middleware/auth.ts:105`) verifies HMAC with timing-safe comparison.
4. `validateReplayProtection` (`server/src/routes/ingest.ts:24`) checks timestamp drift + nonce.
5. `processConfiguration` / `processExecutions` persist telemetry.

A legacy `/api/ingest` path is mounted at `server/src/index.ts:94-97` with a deprecation warning.

**Auth entry points (`server/src/index.ts:86-88`).**
- `POST /api/login` — guarded by `loginLimiter`.
- `POST /api/auth/refresh` — exchanges refresh token for new access token.
- `POST /api/auth/logout` — invalidates refresh token.

**Scheduler boot (`server/src/index.ts:129-146`).**
- `setInterval(checkHeartbeats, 60s)` at `index.ts:129-131` — heartbeat and rotation-miss checks.
- `seedAdminUser`, `ensureModelsLoaded`, `startReportScheduler`, `startDataRetention` — fire-and-forget after `app.listen` at `index.ts:133-146`.

**Root scripts (`package.json:7-13`).**
- `npm run dev` — `concurrently` runs server (nodemon) + client (Vite, `--host`).
- `npm run build` — `build:workflow` → `build --prefix server` (tsc) → `build --prefix client` (vite).
- `npm run install:all` — installs root, server, and client deps.

**Deep dive.** The graphify knowledge graph at `graphify-out/` (regenerate via `/graphify`) contains 382 nodes and 52 communities. See `graphify-out/GRAPH_REPORT.md` for god nodes and surprising connections.

**How to navigate this doc set.** Start here, jump to the feature doc for the area you're touching. Every feature doc lists exact file:line entry points so you can open the right file in one keystroke.
