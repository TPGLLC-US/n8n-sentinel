# Changelog

## [Unreleased]

### Added

- **Jest test suite** — Server-side Jest + `ts-jest` + `supertest` scaffold at `server/jest.config.ts`; first specs cover `safe-fetch` IPv4/IPv6 blocklist. Run via `npm test`.

### Security

- **`ENCRYPTION_KEY` required in production** — Process throws when the env var is unset under `NODE_ENV=production`; dev fallback retained with a warning. `server/src/services/encryption.ts`
- **Rate-limit `/api/auth/refresh` (5/min) and `/api/auth/logout` (10/min).** `server/src/middleware/rate-limit.ts`

### Fixed

- **Scheduler lifecycle** — Heartbeat interval is now cleanable on shutdown, boot failures in one scheduler don't block others, and `SIGTERM`/`SIGINT` trigger graceful HTTP close. `server/src/services/scheduler.ts`, `server/src/index.ts`
- **Duplicate active alerts** — TOCTOU race in `createAlert` (SELECT-then-INSERT) eliminated by a partial unique index on `(alert_type, instance_id) WHERE acknowledged_at IS NULL`, combined with `ON CONFLICT DO NOTHING`. Migration backfills any existing duplicates before the index is built. `server/migrations/`, `server/src/services/alerts.ts`

## [0.3.1] - 2026-03-08

### Fixed — Error Enrichment & Data Ingestion

- **Configuration ingestion broken** — `processConfiguration` in `ingest.ts` had two INSERT column mismatches:
  - `INSERT INTO workflows` listed 8 columns but only provided 7 values (missing `last_synced_at`)
  - `INSERT INTO workflow_resources` listed 9 columns but only provided 8 values (missing `last_seen_at`)
  - This caused ALL workflow and resource syncs to fail silently, which in turn caused `processExecutions` to skip executions for unregistered workflows
- **Duplicate resources crash** — `workflow_resources` bulk INSERT failed with "ON CONFLICT DO UPDATE command cannot affect row a second time" when a workflow referenced the same resource from multiple nodes. Fixed by deduplicating by `(workflow_id, resource_type, resource_identifier)` before inserting
- **API key encryption round-trip** — `decrypt()` in `encryption.ts` used `decipher.update(ciphertext) + decipher.final('utf8')` which caused Buffer-to-string coercion producing corrupted output (e.g., em dashes from raw byte misinterpretation). Fixed to use `Buffer.concat()` then `.toString('utf8')`
- **API key save endpoint** — Added round-trip verification (`encrypt` → `decrypt` → compare) in `PUT /api/instances/:id/api-key` to catch encryption bugs before storing. Also trims whitespace from keys
- **Enrichment not fetching error data** — `fetchExecutionFromN8n` in `ai-fix.ts` was missing `?includeData=true` query parameter, causing n8n API to omit the execution data field containing error details
- **Enrichment errors silently swallowed** — `enrichErrorDetails` now returns a `reason` string on failure and logs each step, so the client can display actionable feedback
- **API key sanitization** — Added Unicode lookalike replacement (em/en dashes, smart quotes) and non-Latin1 character stripping in `fetchExecutionFromN8n` to handle copy-paste issues from rich text sources

### Added — Error Enrichment UI

- **API key management** — New section on Instance Detail page to save/clear encrypted n8n API key per instance
- **Enrichment feedback** — Error Reporting dashboard now shows:
  - Loading spinner during enrichment
  - Actionable message if API key is missing (with link to Instance page)
  - Specific failure reasons from the server
- **`has_api_key` flag** — Errors list API now includes whether the instance has an API key configured
- **Diagnostic logging** — `processExecutions` now logs execution count, error count, ID range, and warnings for missing workflows

### Files Changed

- `server/src/services/ingest.ts` — Fixed both INSERT mismatches, added resource deduplication, added diagnostic logging
- `server/src/services/encryption.ts` — Fixed Buffer decryption bug
- `server/src/services/ai-fix.ts` — Added `?includeData=true`, API key sanitization, enrichment reason propagation
- `server/src/routes/instances.ts` — Added `PUT /:id/api-key` with round-trip verification, `has_n8n_api_key` in GET
- `server/src/routes/errors.ts` — Added `has_api_key` to errors list query
- `client/src/pages/InstanceDetail.tsx` — API key input UI
- `client/src/pages/ErrorReporting.tsx` — Enrichment feedback UI with loading states and actionable messages

## [0.3.0] - 2026-03-05

### Added — Token Usage Dashboard

- **Interactive datatable** on the Token Usage page using `@tanstack/react-table`
  - Sortable columns (date, workflow, model, tokens, cost, status)
  - Global search across all fields
  - Pagination with configurable page sizes (10/20/50/100)
  - Summary stat cards: Input Tokens, Output Tokens, Total Calls, Estimated Cost
- **Workflow column** showing which workflow generated each token usage entry
- **Provider logos** from models.dev for visual model identification
- **Execution status badges** with color coding (success/error/running)
- **Per-model cost estimation** using a pricing table for GPT-4o, GPT-4o-mini, GPT-3.5, Claude 3.5 Sonnet, Claude 3 Haiku, Gemini Pro, and Gemini Flash
- **Server API enhancements:**
  - `GET /api/metrics/tokens` now includes `workflow_name` via JOIN
  - New `GET /api/metrics/tokens/detail` endpoint with per-execution rows, pagination, and workflow metadata

### Changed — Reporter Workflow (Token Extraction)

- **Postgres-based token extraction** replaces HTTP `includeData=true` approach
  - Eliminated "Bad request - Invalid string length" errors from large payloads
  - SQL query runs directly on n8n's Postgres DB, extracting only token counts
  - Supports OpenAI, Anthropic, Google Gemini, and Langchain token formats
- **Dynamic execution ID filtering** — SQL uses execution IDs from the HTTP node input instead of a time-based window
- **Model name dereferencing** — resolves model names from n8n's flatted serialization format (numeric index references → actual model strings like "gpt-5")
- **Build system** extended to handle `{{SQL:name}}` placeholders and `__EXEC_IDS__` dynamic expression wrapping

### Changed — Build System

- `workflow/build.js` now supports SQL file injection into Postgres nodes
- SQL files with `__EXEC_IDS__` placeholder are automatically wrapped in n8n expressions that inject execution IDs from the previous node's input at runtime

### Known Limitations

- **Direct API nodes with `simplify: true`** (Anthropic, OpenAI, Gemini, Ollama) strip token usage from execution data before storage. Token tracking currently works for:
  - Langchain chains and agents (which store full response data including `tokenUsage`)
  - Direct API nodes with `simplify: false`
- Pending n8n schema update to expose token usage metadata for simplified executions

### Files Changed

- `workflow/sql/token-extraction.sql` — New SQL for Postgres-based token extraction
- `workflow/scripts/process-executions.js` — Merges HTTP metadata + Postgres token rows
- `workflow/build.js` — Extended for SQL injection and expression wrapping
- `server/src/routes/metrics.ts` — Enhanced token endpoints with workflow JOINs
- `client/src/pages/TokenUsage.tsx` — Full rewrite with interactive datatable
- `server/src/services/ingest.ts` — Pre-extracted token_usage support with lookupModel()

## [0.2.0] - 2026-03-04

### Added — AI Model Detection (models.dev Integration)

- Dynamic AI model identification via models.dev API
- `server/src/services/models.ts` — fetches & caches model catalog (6hr TTL)
- Provider logos on the Resources page from `models.dev/logos/{provider}.svg`
- Enhanced extractor detects ALL langchain LM nodes dynamically

## [0.1.0] - 2026-03-03

### Added — Initial Dashboard

- Core telemetry collection: workflows, executions, alerts
- Push-based Reporter workflow with HMAC-SHA256 signing
- 4-step instance registration modal
- Dashboard pages: Overview, Instances, Executions, Alerts, Resources, Settings
- Dark glass-card UI theme
- Docker Compose setup with Postgres
