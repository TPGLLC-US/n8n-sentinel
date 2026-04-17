# Reporter Workflow

**Purpose.** An n8n workflow template that users import into their own n8n instance. It periodically collects configuration, executions, and heartbeats and POSTs them (HMAC-signed) to Sentinel. Native n8n nodes plus JavaScript token extraction keep the template self-contained.

**Entry points.**
- `POST /{accountToken}/{instanceToken}/ingest` — path-based (preferred). Mounted at `server/src/index.ts:91` with `validateIngestPath` middleware.
- `POST /api/ingest` — legacy body-based endpoint, marked deprecated at `server/src/index.ts:94-97`.
- Handler: `server/src/routes/ingest.ts:66` (`ingestLimiter`, `validateSignature`, async handler).

**Build pipeline.**
- Source:
  - `workflow/workflow.template.json` (21 nodes).
  - `workflow/scripts/*.js` — `route-telemetry.js`, `process-executions.js`, `build-payload.js`, `extract-tokens.js`.
  - `workflow/sql/*.sql` (optional) for embedded Postgres queries.
- Compiler: `workflow/build.js`. Running `npm run build:workflow` (`package.json:9`):
  1. Loads template text, scans for `{{SCRIPT:name}}` placeholders (`build.js:26-41`) and `{{SQL:name}}` placeholders (`build.js:43-58`).
  2. Parses the template JSON, walks every node, and replaces matching `parameters.jsCode` / `parameters.query` with inlined file contents (`build.js:67-116`).
  3. For SQL queries containing `__EXEC_IDS__`, wraps in an n8n expression injecting execution IDs from previous node output (`build.js:101-109`).
  4. Writes output to `client/public/reporter-workflow.json` (currently ~26 KB, 21 nodes) via `build.js:119-121`.
- See `workflow/README.md` for adding new Code nodes.

**Template shape.** 21 native n8n nodes: Schedule Trigger, HTTP Request (n8n API), Code nodes (route-telemetry, process-executions, build-payload, extract-tokens), Set/Merge/Loop nodes, final HTTP Request to the Sentinel webhook. JS token extraction lives in `workflow/scripts/extract-tokens.js` (rejects Python nodes, supports Anthropic/OpenAI/Google provider shapes).

**Compiled output download.** `client/src/pages/InstanceDetail.tsx` fetches `/api/instances/:id/download-credentials` (`server/src/routes/instances.ts:535`), then rewrites the compiled JSON in-browser:
- `YOUR_SENTINEL_URL` to `webhook_url` from server.
- `YOUR_INSTANCE_ID` to instance UUID.
- `YOUR_HMAC_SECRET` to fresh or previously-recorded secret.
- `YOUR_N8N_URL` to verified `base_url`.

Credentials are type-only refs (`{id:"",name:""}`) so n8n prompts the operator to pick the matching credential on import.

**Auth (inbound).**
- HMAC-SHA256 of the JSON body, base64-encoded, sent as `X-Sentinel-Signature`.
- `validateIngestPath` (`server/src/middleware/auth.ts:59-102`) matches `accountToken` against the `settings.account_ingest_token` row and `instanceToken` against `instances.ingest_token`. Returns 404 for either mismatch and 403 for disabled instances.
- `validateSignature` (`server/src/middleware/auth.ts:105-162`) reuses `req.instance` (or falls back to a legacy body lookup) and calls `verifyHmacSignature` (`middleware/auth.ts:25-56`) with `crypto.timingSafeEqual`. A 24-hour grace window accepts `hmac_secret_previous` after rotation.

**Replay protection (`server/src/routes/ingest.ts:24-62`).**
- Timestamp drift no more than 5 minutes (`TIMESTAMP_TOLERANCE_MS` at `:22`).
- Nonce format `/^[a-zA-Z0-9_-]{8,64}$/` (`:42`).
- Nonces recorded in `nonce_cache` with 10-minute TTL (`NONCE_TTL_MINUTES` at `:21`, insert at `:55-58`); replay attempts return 409.
- Ingest rate limit: 100 requests / 15 minutes per IP (`ingestLimiter` at `:12-18`).

**Data flow (one cycle).**
1. Schedule or manual trigger fires. `route-telemetry.js` Code node selects `telemetry_type` (`heartbeat`, `configuration`, `executions`, `manual`, or `error`).
2. HTTP Request nodes pull from the n8n REST API (`/rest/workflows`, `/rest/executions`).
3. `process-executions.js` normalises each execution; `extract-tokens.js` walks JSON output for token-usage shapes.
4. `build-payload.js` composes `{instance_id, telemetry_type, timestamp, nonce, data, instance_metadata?}` and signs with the HMAC secret.
5. Final HTTP Request POSTs to the instance's webhook URL with `X-Sentinel-Signature`.
6. Server replies `202 accepted` immediately (`routes/ingest.ts:82`) to avoid Reporter timeouts, then processes asynchronously:
   - `heartbeat` updates `last_heartbeat`, `n8n_version`, `reporter_version`, runs `checkReporterVersion`, detects URL mismatch (`routes/ingest.ts:89-129`).
   - `configuration` calls `processConfiguration` (`services/ingest.ts:52`) plus `checkWorkflowThresholds` (`routes/ingest.ts:130-138`).
   - `executions` / `manual` / `error` call `processExecutions` (`services/ingest.ts:149`), upserting executions and token usage.

**Known issues.**
- Nonce now required (was optional); min length 16 (was 8) since 2026-04-17. Reporters older than v1.4.0 will be rejected.

**Deep dive.** See `graphify-out/` for the Reporter Workflow community — tightly linked to Auth (HMAC/replay), Instance Management (token minting/rotation), and Resources Inventory (configuration to `extractor.ts`).
