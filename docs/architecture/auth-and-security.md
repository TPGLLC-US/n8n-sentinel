# Auth & Security

**Purpose.** Authenticate dashboard users (JWT Bearer + refresh token) and protect outbound/inbound traffic — SSRF-safe fetches for user-supplied URLs, HMAC-signed ingest with replay protection, AES-256-GCM at rest for stored secrets.

**Entry points.**
- `POST /api/login` — `server/src/middleware/session.ts:41` (handler `login`, rate-limited by `loginLimiter`).
- `POST /api/auth/refresh` — `server/src/middleware/session.ts:76` (handler `refresh`).
- `POST /api/auth/logout` — `server/src/middleware/session.ts:106` (handler `logoutHandler`).
- `requireAuth` middleware — `server/src/middleware/session.ts:19` (guards all `/api/*` protected routers; mounted `server/src/index.ts:100-108`).

**Key files.**
- `server/src/middleware/session.ts` — login / refresh / logout handlers + `requireAuth`.
- `server/src/lib/auth.ts` — password hashing, JWT generation/verification, refresh-token CRUD, env validation (`getSessionSecret`).
- `server/src/services/encryption.ts` — `encrypt` / `decrypt` (AES-256-GCM, `iv:authTag:ciphertext` base64 format).
- `server/src/lib/safe-fetch.ts` — SSRF-hardened `fetch` wrapper for arbitrary user URLs (n8n webhooks, API keys verification).
- `server/src/middleware/auth.ts` — HMAC signature verification for ingest; path-based instance resolution.
- `server/src/middleware/validate.ts` — `validateUUID(param)` helper (400 on malformed UUIDs).
- `server/src/middleware/rate-limit.ts` — `loginLimiter`, `diagnosisLimiter`.

**Auth model.** Stateless JWT Bearer tokens (HS256) with 1-hour access expiry (`lib/auth.ts:67`) and 7-day refresh tokens stored in Postgres as SHA-256 hashes (`lib/auth.ts:68`, `createRefreshToken` at `lib/auth.ts:86-97`). Refresh tokens are opaque 48-byte random base64url strings. No cookies are used — client stores tokens in memory/localStorage and attaches `Authorization: Bearer <jwt>` via `authFetch`. No cookies means no CSRF surface for the API.

**Password hashing.** `bcryptjs` at 12 rounds (`lib/auth.ts:31`). Admin user seeded on boot from `SENTINEL_ADMIN_EMAIL` + `SENTINEL_ADMIN_PASSWORD`; production enforces a 12-character minimum password (`lib/auth.ts:47-50`).

**Session secret.** `getSessionSecret()` (`lib/auth.ts:20-27`) fails fast if `SESSION_SECRET` is unset or <32 chars, calling `process.exit(1)`. Invoked at server startup (`server/src/index.ts:15`) so misconfiguration is immediate and loud.

**Encryption at rest.** AES-256-GCM via `encrypt` / `decrypt` (`services/encryption.ts:31`, `:41`). Key source precedence (`services/encryption.ts:9-29`): `ENCRYPTION_KEY` env var (hex-64 decoded directly, otherwise SHA-256 derived), falling back to SHA-256 of `SESSION_SECRET` with a warning for dev ergonomics. Production deployments should set `ENCRYPTION_KEY` explicitly. Used for n8n API keys and any other sensitive column.

**SSRF defense (`lib/safe-fetch.ts`).** `safeFetch(url, options, opts)`:
1. Parses URL and rejects non-`http(s)` protocols (`:79-81`).
2. Enforces HTTPS in production unless `allowHttp` is set (`:76-78`).
3. If hostname is literal IPv4, checks against `BLOCKED_CIDRS` (`:10-17`: loopback 127/8, RFC 1918 10/8, 172.16/12, 192.168/16, link-local 169.254/16 incl. cloud metadata, and 0.0.0.0/8).
4. Otherwise resolves DNS (A + AAAA) via `dns.resolve4` / `dns.resolve6` and checks every resolved IP (`:92-105`). IPv6 blocks `::1`, ULA `fc00::/7` (`fc`/`fd` prefix), link-local `fe80::`, and IPv4-mapped `::ffff:` addresses.
5. Disables redirect following (`redirect: 'manual'` at `:116`) so a 302 can't bounce to an internal IP.
6. Aborts on timeout (`AbortSignal.timeout(timeoutMs)`, default 8s, `:115`).

Throws `SSRFError` on any violation; callers should treat SSRFError as a user-facing 400/403.

**HMAC signature verification.** Ingest requests carry `X-Sentinel-Signature` (base64 HMAC-SHA256 over the JSON body). `verifyHmacSignature` (`middleware/auth.ts:25-56`) uses `crypto.timingSafeEqual` for comparison. A 24-hour grace window (`middleware/auth.ts:45-53`) allows the previous secret after rotation (`hmac_secret_previous` + `hmac_secret_rotated_at`).

**Rate limits (`middleware/rate-limit.ts`).**
- `loginLimiter` — 5 attempts / min / IP (`:4-10`).
- `diagnosisLimiter` — 10 / min / IP, applied to Claude-powered endpoints (`:13-19`).

(Refresh/logout rate limits are planned for Phase 2b.)

**Data flow (login → authenticated request).**
1. Client posts `{email, password}` to `/api/login`.
2. Server fetches user, `verifyPassword` (bcrypt.compare), updates `last_login_at`.
3. Server mints JWT (`generateAccessToken`) + refresh token (48-byte random, hashed and stored in `refresh_tokens`).
4. Response `{ token, refreshToken, user }` — client stores both.
5. Client's `authFetch` attaches `Authorization: Bearer <token>` to every `/api/*` call; on 401 it posts `refreshToken` to `/api/auth/refresh` and retries.
6. Logout sends `{refreshToken}` to `/api/auth/logout` which deletes the hash from `refresh_tokens` (`lib/auth.ts:109-112`).

**Known issues.** None at time of writing.

**Deep dive.** See `graphify-out/` community notes for the Auth & Sessions cluster and for `safe-fetch` call sites across services.
