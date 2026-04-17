# Instance Management

**Purpose.** Register, inspect, rotate credentials for, and unregister n8n instances monitored by Sentinel. Each instance owns its own HMAC secret + opaque ingest-path token; the account-wide ingest token is auto-generated on first boot.

**Entry points (all mounted under `/api/instances`, `requireAuth` at `server/src/index.ts:100`).**
- `GET /api/instances` — `server/src/routes/instances.ts:40` — list instances with workflow/execution/error counts.
- `POST /api/instances/verify-n8n` — `server/src/routes/instances.ts:59` — probe a URL, confirm it is n8n, optionally fetch baseline counts.
- `POST /api/instances` — `server/src/routes/instances.ts:284` — register. Generates 32-byte HMAC secret + 24-char ingest token, returns `hmac_secret` and `webhook_url` **exactly once**.
- `GET /api/instances/:id` — `server/src/routes/instances.ts:353` — instance detail + stats.
- `PATCH /api/instances/:id` — `server/src/routes/instances.ts:397` — update mutable fields.
- `DELETE /api/instances/:id` — `server/src/routes/instances.ts:426` — remove instance.
- `PATCH /api/instances/:id/toggle` — `server/src/routes/instances.ts:439` — enable/disable (disabled instances → 403 on ingest, `middleware/auth.ts:89-92`).
- `POST /api/instances/:id/rotate-secret` — `server/src/routes/instances.ts:455` — rotate HMAC with 24h grace (moves `hmac_secret` → `hmac_secret_previous`, sets `hmac_secret_rotated_at`).
- `POST /api/instances/:id/rotate-ingest-token` — `server/src/routes/instances.ts:481` — mint new ingest token and raise `INGEST_TOKEN_ROTATED` alert.
- `GET /api/instances/:id/webhook-url` — `server/src/routes/instances.ts:517` — build current webhook URL (`accountToken/instanceToken/ingest`).
- `GET /api/instances/:id/download-credentials` — `server/src/routes/instances.ts:535` — returns `{hmac_secret, base_url, webhook_url}` for populating the reporter template.
- `PUT /api/instances/:id/api-key` — `server/src/routes/instances.ts:563` — encrypt (AES-256-GCM) and persist the n8n API key with round-trip verification.
- `GET /api/instances/:id/workflows` / `…/resources` / `…/executions` — nested listings.

**Key files.**
- `server/src/routes/instances.ts` — all handlers above; helpers:
  - `getAccountIngestToken()` (`:9-21`) — reads or auto-creates the account token row in `settings`.
  - `buildWebhookUrl()` (`:23-26`) — `${SENTINEL_PUBLIC_URL || req host}/${accountToken}/${instanceToken}/ingest`.
  - `isValidHttpUrl()` (`:28-35`) — http(s) URL check used by register + verify.
- `server/src/lib/tokens.ts` — `generateIngestToken(bytes)` producing url-safe opaque tokens.
- `server/src/services/encryption.ts` — AES-256-GCM for the `n8n_api_key_encrypted` column.
- `server/src/lib/safe-fetch.ts` — `safeFetch` used by `verify-n8n` to probe customer URLs without SSRF risk.
- `client/src/pages/Instances.tsx` — list + register form + credentials display (`RegisterForm` at `:180`, `CredentialsDisplay` at `:441`).
- `client/src/pages/InstanceDetail.tsx` — detail page, rotate/toggle/delete actions, API-key entry, workflow downloader.

**Data flow (register → import workflow).**
1. User submits name + base_url (+ optional baseline counts) to `POST /api/instances`.
2. Route rejects duplicate `base_url` (409, `:304-310`) and duplicate case-insensitive `name` (409, `:318-321`).
3. Generates `crypto.randomBytes(32).toString('base64')` HMAC secret and 24-byte `ingest_token` (`:323-325`).
4. Inserts row; account-wide `account_ingest_token` is fetched or lazily created by `getAccountIngestToken`.
5. Response returns `hmac_secret`, `base_url`, and `webhook_url` (the only chance to see the secret).
6. User opens `InstanceDetail`, clicks **Download Credentials** → client fetches `/download-credentials` and populates the reporter workflow template (YOUR_SENTINEL_URL / YOUR_INSTANCE_ID / YOUR_HMAC_SECRET / YOUR_N8N_URL) before downloading the JSON for import.
7. Optionally, user pastes n8n API key → `PUT /api/instances/:id/api-key` encrypts with AES-256-GCM, round-trips to verify, stores as `n8n_api_key_encrypted`.

**Rotation flows.**
- **HMAC rotate** copies current secret to `hmac_secret_previous`, generates a new one, and stamps `hmac_secret_rotated_at`. The ingest middleware accepts either secret for 24 hours (`server/src/middleware/auth.ts:44-53`).
- **Ingest token rotate** invalidates the old webhook URL immediately and creates an `INGEST_TOKEN_ROTATED` alert so operators know to re-download and re-import.

**Known issues.** None at time of writing.

**Deep dive.** See `graphify-out/` — the Instance Management community is tightly coupled to the Reporter Workflow and Auth clusters via `getAccountIngestToken`, `buildWebhookUrl`, and `encrypt/decrypt`.
