# Frontend

**Purpose.** React 19 + Vite single-page app for the Sentinel dashboard. Uses react-router for navigation, localStorage for tokens, and a thin `authFetch` wrapper that transparently refreshes expired access tokens.

**Entry points.**
- `client/src/main.tsx` — Vite entry; renders `<App />` inside `<StrictMode>` into `#root` (`:6-10`).
- `client/src/App.tsx` — router. `BrowserRouter` + `Routes` (`:21-40`). `/login` is the only public route; everything else is wrapped in `<AuthGuard />` and the shared `<Layout />`.

**Routes and pages (`client/src/App.tsx:22-40`).**
| Path | Component | File |
|---|---|---|
| `/login` | `Login` | `client/src/pages/Login.tsx` |
| `/` (index) | `Overview` | `client/src/pages/Overview.tsx` |
| `/instances` | `Instances` | `client/src/pages/Instances.tsx` |
| `/instances/:id` | `InstanceDetail` | `client/src/pages/InstanceDetail.tsx` |
| `/workflows` | `Workflows` | `client/src/pages/Workflows.tsx` |
| `/executions` | `Executions` | `client/src/pages/Executions.tsx` |
| `/resources` | `Resources` | `client/src/pages/Resources.tsx` |
| `/tokens` | `TokenUsage` | `client/src/pages/TokenUsage.tsx` |
| `/alerts` | `Alerts` | `client/src/pages/Alerts.tsx` |
| `/error-reporting` | `ErrorReporting` | `client/src/pages/ErrorReporting.tsx` |
| `/settings` | `Settings` | `client/src/pages/Settings.tsx` |

Auth gating is handled by `<AuthGuard />` (`client/src/components/AuthGuard.tsx`) wrapping the entire protected tree (`App.tsx:25-38`).

**Shared utilities.**
- `client/src/lib/auth.ts`:
  - `login(email, password)` — POSTs to `/api/login`, stores `token` and `refreshToken` in localStorage (`:3-23`).
  - `logout()` — best-effort server revoke + clears localStorage + redirects to `/login` (`:25-38`).
  - `getToken()` / `isAuthenticated()` (`:40-46`).
  - `refreshAccessToken()` (`:48-65`) — POSTs the refresh token to `/api/auth/refresh`, stores the new access token.
  - `authFetch(url, options)` (`:67-89`) — attaches `Authorization: Bearer <token>`, retries exactly once on 401 after refreshing; calls `logout()` if refresh also fails.
- `client/src/lib/safe-href.ts` — `safeHref(url)` (`:5-12`) returns `'#'` unless the URL starts with `http://` or `https://`, blocking `javascript:` and other XSS-prone schemes in rendered `<a href>` values.
- `client/src/lib/api.ts` — additional API helpers built on `authFetch`.

**Build / dev configuration (`client/vite.config.ts`).**
- Dev proxy (`:14-24`) forwards `/api` and the per-instance ingest path pattern `^/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+/ingest` to `http://localhost:${PORT}` — `PORT` read via `loadEnv` from the monorepo root `.env` (`:6-8`).
- Dev command (from `package.json:8`): `concurrently` runs `npm run dev --prefix client -- --host` (Vite) plus the server.
- `VITE_API_URL` overrides `API_BASE` (defaults to `/api`) in `client/src/lib/auth.ts:1` for environments where the proxy is not used.

**Data flow (typical page).**
1. User navigates to a protected route; `<AuthGuard />` checks `isAuthenticated()` and redirects to `/login` if missing a token.
2. Page component mounts, calls `authFetch('/whatever')`.
3. `authFetch` attaches Bearer token → Vite proxy (dev) or same-origin (prod static) → Express `requireAuth`.
4. On 401, `authFetch` refreshes once; on second 401 it calls `logout()` which clears tokens and redirects.
5. JSON is rendered by the page; errors are surfaced per-page (no global error boundary beyond React's defaults).

**Known issues.** None at time of writing.

**Deep dive.** See `graphify-out/` for the Frontend community — `authFetch` is the single bottleneck edge into the API, and `InstanceDetail.tsx` is the largest page (workflow downloader + API key entry + rotation controls).
