# Alerts & Monitoring

**Purpose.** Detect operational issues on monitored n8n instances (missed heartbeats, workflow-count drift, outdated reporter, ingest-token rotation) and surface them in the dashboard, optionally mirrored to email via Resend.

**Entry points.**
- `GET /api/alerts` — `server/src/routes/alerts.ts:6` — returns all unacknowledged alerts (joined to instance name).
- `POST /api/alerts/:id/acknowledge` — `server/src/routes/alerts.ts:16` — resolves an alert (sets `acknowledged_at`).
- Scheduled: `checkHeartbeats()` runs every 60s via `setInterval` at `server/src/index.ts:129-131`.
- Per-ingest: `checkWorkflowThresholds` and `checkReporterVersion` fire inline in `server/src/routes/ingest.ts:127-138`.
- Both router endpoints mounted under `requireAuth` at `server/src/index.ts:104`.

**Key files.**
- `server/src/services/alerts.ts` — `AlertType` enum (`:8-18`), `createAlert` with duplicate-suppression (`:20-41`), `getActiveAlerts` (`:43-52`), `resolveAlert` (`:54-59`), checks (`checkHeartbeats` `:63`, `checkWorkflowThresholds` `:115`, `checkReporterVersion` `:189`), `autoResolveAlert` (`:170`), `versionsBehind` (`:179`), `sendAlertEmail` (`:206`).
- `server/src/services/resend.ts` — `getResendClient` (`:11`), `getFromEmail` (`:28`), `getRecipients` (`:36`).
- `server/src/emails/AlertNotification.tsx` — React Email component; `renderAlertNotification` returns the rendered HTML.
- `server/src/routes/alerts.ts` — thin HTTP surface.
- `client/src/pages/Alerts.tsx` — UI listing + acknowledge action.

**Alert types (`AlertType` at `services/alerts.ts:8-18`).**
| Constant | Type string | Raised by |
|---|---|---|
| `MISSED_HEARTBEAT` | `heartbeat_missed` | `checkHeartbeats` when `last_heartbeat < NOW() - 5 min` |
| `HIGH_ERROR_RATE` | `error_rate_high` | (placeholder — `checkErrorRates` not implemented yet) |
| `WORKFLOW_COUNT_ZERO` | `workflow_count_zero` | `checkWorkflowThresholds` |
| `WORKFLOW_COUNT_DROP` | `workflow_count_drop` | `checkWorkflowThresholds` (>20% below baseline) |
| `WORKFLOW_COUNT_SPIKE` | `workflow_count_spike` | `checkWorkflowThresholds` (>50% above baseline) |
| `INSTANCE_URL_MISMATCH` | `instance_url_mismatch` | ingest route when `instance_url` differs from stored `base_url` |
| `REPORTER_OUTDATED` | `reporter_outdated` | `checkReporterVersion` vs `LATEST_REPORTER_VERSION` (`:6`) |
| `INGEST_TOKEN_ROTATED` | `ingest_token_rotated` | `POST /api/instances/:id/rotate-ingest-token` |
| `HEARTBEAT_AFTER_ROTATION` | `heartbeat_after_rotation` | `checkHeartbeats` second pass (offline within 24h of rotation) |

Thresholds are constants at the top of the workflow section: `THRESHOLD_DROP_PERCENT = 20` (`alerts.ts:112`), `THRESHOLD_SPIKE_PERCENT = 50` (`alerts.ts:113`).

**Check cadence.**
- Heartbeat checks every 60s (`index.ts:129-131`). `checkHeartbeats` runs two queries: plain missed-heartbeat (>5 min) then the rotation-follow-up correlation.
- Workflow thresholds and reporter version run per `configuration`/`heartbeat` ingest (`routes/ingest.ts:127-138`), so they are only as fresh as the reporter schedule.

**Duplicate suppression and auto-resolve.**
- `createAlert` short-circuits if an unacknowledged alert of the same `(alert_type, instance_id)` already exists (`alerts.ts:22-29`).
- `autoResolveAlert` (`alerts.ts:170-176`) sets `acknowledged_at = NOW()` and `acknowledged_by = 'system-auto'` (see `routes/ingest.ts:117-122` for the URL-mismatch auto-resolve when URLs re-align, and `alerts.ts:164-165, :199-201` for threshold/reporter-version auto-clears).

**Email notification flow (`sendAlertEmail`, `alerts.ts:206`).**
1. Reads `alert_email_enabled` via `getSetting`; exits if not `'true'` (`:213-215`).
2. Reads `alert_email_types` CSV; exits if the alert type is not opted in (`:218-222`).
3. Fetches instance name, renders `AlertNotification` HTML (`:228-234`).
4. Gets Resend client, from address, and recipients (all via `services/resend.ts`), sends the email.
5. Called fire-and-forget from `createAlert` (`:38-40`) — delivery failures log but do not block alert creation.

**Data flow.**
1. Reporter posts telemetry → ingest route triggers relevant checks or `checkHeartbeats` cron fires every minute.
2. Check functions call `createAlert` which inserts into `alerts` and fans out an email (if enabled).
3. Dashboard polls `GET /api/alerts`; operator clicks to acknowledge, client calls `POST /api/alerts/:id/acknowledge` and the row's `acknowledged_at` is set.

**Known issues.** None at time of writing.

**Deep dive.** See `graphify-out/` for the Alerts & Monitoring community — overlaps with Instance Management (URL mismatch, token rotation) and Reporter Workflow (reporter-version surveillance).
