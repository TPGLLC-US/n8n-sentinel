# AI Diagnose & Auto-Fix — Developer Reference

## Overview

Two AI-powered features for n8n workflow errors:

1. **Diagnose** — Lightweight analysis of an error using only the error message, node name, and workflow metadata. No n8n API access needed. Result cached on `executions.ai_diagnosis` (JSONB).
2. **Fix** — Heavy operation that fetches the full workflow JSON from the n8n instance, sends it to Claude along with error context, receives a patched `nodes` array, and PATCHes it back to n8n via API.

Both use **Anthropic Claude** (`claude-sonnet-4-20250514`) via direct API calls.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  n8n Instance                                               │
│  ┌──────────────┐    ┌──────────────────────┐               │
│  │ Error Trigger │───>│ Reporter Workflow     │               │
│  └──────────────┘    │ (build-payload.js)    │               │
│                      └──────────┬───────────┘               │
│                                 │ POST /api/ingest           │
│  <── PATCH /api/v1/workflows ───┤ (HMAC-signed)             │
│  (fix applied back to n8n)      │                            │
└─────────────────────────────────┼───────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│  Sentinel Server                                            │
│                                                             │
│  ingest.ts ──> processExecutions() ──> DB                   │
│       │                                                     │
│       └── if auto_fix_enabled ──> attemptAiFix() ─────┐     │
│                                                       │     │
│  errors.ts                                            │     │
│    POST /:id/diagnose ──> diagnoseError() ────────────┤     │
│    POST /:id/enrich   ──> enrichErrorDetails()        │     │
│    POST /:id/fix      ──> attemptAiFix() ─────────────┤     │
│                                                       │     │
│                                          ┌────────────▼──┐  │
│                                          │  ai-fix.ts    │  │
│                                          │  (service)    │  │
│                                          └───────┬───────┘  │
│                                                  │          │
│                              Anthropic API ◄─────┘          │
└─────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│  Client (ErrorReporting.tsx)                                │
│                                                             │
│  Error Table ──> click row ──> ExpandedError                │
│    ├── auto-enrich (if missing error_message/error_node)    │
│    ├── [Diagnose] button  ──> POST /errors/:id/diagnose     │
│    ├── [Fix with AI] button ──> POST /errors/:id/fix        │
│    └── DiagnosisPanel (cached result display)               │
└─────────────────────────────────────────────────────────────┘
```

---

## Files

| File | Purpose |
|------|---------|
| `server/src/services/ai-fix.ts` | Core service: `diagnoseError()`, `attemptAiFix()`, `enrichErrorDetails()`, Anthropic API calls, n8n API helpers, token logging |
| `server/src/routes/errors.ts` | REST endpoints: list errors, stats, detail, diagnose, enrich, fix |
| `server/src/routes/ingest.ts` | Auto-fix trigger on `telemetry_type === 'error'` ingest (lines 92-120) |
| `server/src/routes/settings.ts` | Settings CRUD + `getSetting()` helper for `anthropic_api_key`, `auto_fix_enabled`, `max_fixes_per_day` |
| `server/src/services/encryption.ts` | AES-256-GCM encrypt/decrypt for API keys (Anthropic key in settings, n8n API key on instances) |
| `client/src/pages/ErrorReporting.tsx` | Full UI: error table, `ExpandedError`, `DiagnosisPanel`, diagnose/fix buttons |
| `workflow/scripts/build-payload.js` | Reporter: normalizes Error Trigger data into `payload.data.error` shape |
| `workflow/scripts/route-telemetry.js` | Reporter: detects `Error Trigger` fired → sets `telemetry_type = 'error'` |
| `dbschema.sql` | Tables: `executions` (ai_diagnosis JSONB), `ai_fix_attempts`, `token_usage`, `settings` |

---

## DB Tables

### `executions.ai_diagnosis` (JSONB, nullable)
Cached diagnosis result. Shape:
```json
{
  "diagnosis": "string",
  "cause": "string",
  "resolution": "string",
  "category": "code_node_error|expression_error|missing_config|type_mismatch|null_reference|api_error|credential_error|rate_limit|network_error|data_format|unknown",
  "severity": "critical|high|medium|low",
  "fixable": true,
  "token_usage": { "input_tokens": 1234, "output_tokens": 567 }
}
```

### `ai_fix_attempts`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| execution_id | UUID FK → executions | ON DELETE SET NULL |
| instance_id | UUID FK → instances | ON DELETE CASCADE |
| workflow_remote_id | VARCHAR(255) | n8n workflow ID |
| workflow_name | VARCHAR(500) | |
| error_message | TEXT | |
| error_node | VARCHAR(255) | |
| status | VARCHAR(20) | `pending` → `in_progress` → `success`/`failed`/`rejected` |
| ai_diagnosis | TEXT | AI's diagnosis text |
| ai_fix_description | TEXT | What was changed |
| fix_applied | BOOLEAN | Whether PATCH succeeded |
| triggered_by | VARCHAR(20) | `manual` or `auto` |
| created_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |

### `token_usage` (source = 'sentinel')
Sentinel's own AI calls are logged with `source = 'sentinel'` and `call_type = 'diagnosis'` or `'fix'`.

### `settings`
| Key | Encrypted | Default | Purpose |
|-----|-----------|---------|---------|
| `anthropic_api_key` | Yes | null | Claude API key |
| `auto_fix_enabled` | No | null | `'true'` to enable auto-fix on error ingest |
| `max_fixes_per_day` | No | `'10'` | Per-instance daily limit |

---

## API Endpoints

### `GET /api/errors`
Lists error executions with latest `ai_fix_status` (subquery on `ai_fix_attempts`).

### `GET /api/errors/stats`
Aggregates: errors 24h/7d, error rate, top failing workflows/nodes, AI fix stats.

### `GET /api/errors/:id`
Single error detail + all `ai_fix_attempts` history.

### `POST /api/errors/:id/enrich`
If `error_message` or `error_node` is null, fetches execution from n8n via `GET /api/v1/executions/:id?includeData=true` and persists the extracted fields.

**Prerequisites:** Instance must have `base_url` + `n8n_api_key_encrypted`.

### `POST /api/errors/:id/diagnose`
Calls `diagnoseError()`. Returns cached result if `ai_diagnosis` already exists.

**Prerequisites:** `anthropic_api_key` in settings.

**Flow:**
1. Load execution + workflow + instance metadata from DB
2. Auto-enrich if error_message/error_node missing
3. Build user message (workflow name, instance, execution ID, node count, failed node, error message)
4. Call Claude with `DIAGNOSIS_SYSTEM_PROMPT` + `N8N_KNOWLEDGE_BASE` (max 2048 output tokens, 30s timeout)
5. Parse JSON response → `DiagnosisResult`
6. Persist on `executions.ai_diagnosis` + log token usage
7. Return result

### `POST /api/errors/:id/fix`
Calls `attemptAiFix(executionId, 'manual')`.

**Prerequisites:** `anthropic_api_key` in settings + instance `base_url` + `n8n_api_key_encrypted`.

**Flow:**
1. Load execution + instance metadata
2. Validate: base_url, n8n API key, Anthropic key all present
3. Check daily fix limit (`max_fixes_per_day` per instance)
4. Create `ai_fix_attempts` row with `status = 'in_progress'`
5. Decrypt n8n API key → fetch workflow via `GET /api/v1/workflows/:id`
6. Build error context + send full workflow JSON to Claude (`FIX_SYSTEM_PROMPT`, max 8192 output tokens, 120s timeout)
7. Parse response → `{ diagnosis, fixable, fix_description, fixed_nodes }`
8. If `fixed_nodes` returned → `PATCH /api/v1/workflows/:id` with `{ nodes: fixed_nodes }`
9. Update `ai_fix_attempts` row with final status
10. Log token usage

**Status outcomes:**
- `success` — fix generated AND applied via PATCH
- `failed` — fix generated but PATCH failed, OR AI error
- `rejected` — AI determined error is not fixable (credentials, API outages, etc.)

---

## Auto-Fix on Error Ingest

Triggered in `ingest.ts` when `telemetry_type === 'error'`:

1. Check `auto_fix_enabled === 'true'` in settings
2. Look up the just-inserted execution by `remote_execution_id`
3. Fire-and-forget `attemptAiFix(executionId, 'auto')` — does NOT block ingest response (202 already sent)
4. Failures logged via `console.warn`, never surface to Reporter

---

## Error Trigger → Ingest Flow

**Reporter workflow** (in n8n):
1. `Error Trigger` node fires on any workflow error in the n8n instance
2. `Route Telemetry` code node detects trigger → `telemetry_type = 'error'`
3. `Build Payload` code node normalizes Error Trigger data:
   ```js
   payload.data.error = {
     id: execution.id,
     workflowId: workflow.id,
     workflowName: workflow.name,
     status: 'error',
     startedAt, stoppedAt, mode,
     error_message: error.message || error.description,
     error_node: execution.lastNodeExecuted
   }
   ```
4. HMAC-signed POST to `POST /api/ingest`

**Server** (`ingest.ts`):
- Calls `processExecutions(instanceId, { executions: [data.error] })` to insert the execution
- Then optionally triggers auto-fix (see above)

---

## Client UI Flow (ErrorReporting.tsx)

### Data Loading
- `GET /api/errors?limit=500` → populates error table
- `GET /api/errors/stats` → populates stat cards

### ExpandedError Component (row click to expand)
1. **Auto-enrich** — If `error_message` or `error_node` is null, fires `POST /errors/:id/enrich` on mount. Shows loading spinner. Displays contextual help if enrichment fails (no API key, no base URL, execution pruned, etc.)
2. **Details panel** — Shows execution ID, failed node, workflow, instance, time, duration
3. **DiagnosisPanel** — If `ai_diagnosis` exists, renders structured diagnosis with severity badge, category label, fixable indicator, root cause, resolution steps, token usage
4. **Action buttons:**
   - **Diagnose** — Visible only if no `ai_diagnosis`. Calls `POST /errors/:id/diagnose`. Shows estimated token cost in tooltip.
   - **Fix with AI** — Always visible. Calls `POST /errors/:id/fix`. Shows estimated token cost (based on node count) in tooltip.
   - **View Execution** — Link to n8n execution URL (if base_url available)
   - **Open Workflow** — Link to n8n workflow URL

### Token Cost Estimates (client-side)
- Diagnosis: ~900 (system prompt) + 150 (context) + error_message_length/4 input tokens, ~300 output
- Fix: ~900 + 150 + error_msg_tokens + (node_count × 800) input tokens, up to 8192 output

---

## Anthropic Integration Details

- **Model:** `claude-sonnet-4-20250514`
- **API:** `POST https://api.anthropic.com/v1/messages` with `x-api-key` + `anthropic-version: 2023-06-01`
- **Diagnosis call:** 2048 max_tokens, 30s timeout
- **Fix call:** 8192 max_tokens, 120s timeout
- **Response parsing:** `parseAiJsonResponse()` handles raw JSON, markdown code fences, and brace extraction
- **Knowledge base:** `N8N_KNOWLEDGE_BASE` constant (~2KB) embedded in both system prompts covering error categories, Code Node rules, expression syntax, what's fixable vs not

---

## n8n API Interactions

| Action | Method | Endpoint | Used By |
|--------|--------|----------|---------|
| Fetch execution details | GET | `/api/v1/executions/:id?includeData=true` | `enrichErrorDetails()` |
| Fetch workflow JSON | GET | `/api/v1/workflows/:id` | `attemptAiFix()` |
| Apply fix | PATCH | `/api/v1/workflows/:id` | `attemptAiFix()` body: `{ nodes: [...] }` |

All n8n API calls use the **instance-level** encrypted API key (`instances.n8n_api_key_encrypted`), decrypted at call time. 15s timeout for workflow/execution fetches. API key sanitization handles Unicode copy-paste artifacts (em/en dashes, smart quotes).

---

## Prerequisites Checklist

For **Diagnose** to work:
- [x] `anthropic_api_key` set in Settings

For **Fix with AI** to work:
- [x] `anthropic_api_key` set in Settings
- [x] Instance has `base_url` configured
- [x] Instance has `n8n_api_key_encrypted` saved (via Instance Detail page)
- [x] Daily limit not exceeded

For **Auto-Fix on ingest** to work:
- [x] All of the above
- [x] `auto_fix_enabled = 'true'` in Settings

---

## Known Limitations

1. **Diagnosis is cached** — Once `executions.ai_diagnosis` is set, subsequent diagnose calls return the cached version. No re-diagnose without manual DB update.
2. **Fix sends full workflow JSON** — Large workflows (50+ nodes) may hit token limits. ~800 tokens per node average.
3. **No rollback** — If a fix makes things worse, there's no automatic undo. The user must manually revert in n8n.
4. **Settings page is partially mock** — The client Settings.tsx has local state but the save calls the real `PUT /api/settings` endpoint. The toggle states are not loaded from the API on mount (known gap).
5. **No fix preview** — The fix is applied immediately. There's no "review before apply" step.
6. **Daily limit is per-instance** — Checked via `ai_fix_attempts` count in last 24h for that instance_id.
