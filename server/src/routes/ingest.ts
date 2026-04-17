import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { validateSignature } from '../middleware/auth';
import { processConfiguration, processExecutions } from '../services/ingest';
import { checkWorkflowThresholds, checkReporterVersion, createAlert, AlertType } from '../services/alerts';
import { query } from '../db';
// AI auto-fix disabled — see feat/fix-with-ai branch

const router = Router();

// Rate limiting: max 100 requests per 15 minutes per IP
const ingestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { status: 'error', message: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ─── Nonce + timestamp replay protection ────────────────────────────────
const NONCE_TTL_MINUTES = 10;
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

export function nonceFormatIsValid(nonce: string): boolean {
    return /^[a-zA-Z0-9_-]{16,64}$/.test(nonce);
}

async function validateReplayProtection(
    nonce: string | undefined,
    timestamp: string | undefined,
    instanceId: string,
): Promise<string | null> {
    if (timestamp) {
        const ts = new Date(timestamp).getTime();
        if (isNaN(ts)) return 'Invalid timestamp format';
        const drift = Math.abs(Date.now() - ts);
        if (drift > TIMESTAMP_TOLERANCE_MS) {
            return `Timestamp rejected: ${Math.round(drift / 1000)}s drift exceeds ${TIMESTAMP_TOLERANCE_MS / 1000}s tolerance`;
        }
    }

    if (!nonce) return 'Missing nonce';
    if (!nonceFormatIsValid(nonce)) return 'Invalid nonce format';

    const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60 * 1000);
    const result = await query(
        'INSERT INTO nonce_cache (nonce, instance_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING nonce',
        [nonce, instanceId, expiresAt],
    );
    if (result.rows.length === 0) return 'Nonce already used (replay detected)';
    return null;
}

// POST /api/ingest - Receive telemetry
// Uses HMAC validation, Rate Limiting, and Replay Protection
router.post('/', ingestLimiter, validateSignature, async (req: Request, res: Response) => {
    // At this point, signature is valid and req.instance is populated
    const { data, telemetry_type, timestamp, nonce } = req.body;
    const instance = req.instance!;

    // Replay protection
    const replayError = await validateReplayProtection(nonce, timestamp, instance.id);
    if (replayError) {
        console.warn(`[ingest] Replay rejected from ${instance.id}: ${replayError}`);
        res.status(409).json({ status: 'error', message: replayError });
        return;
    }

    console.log(`Received ${telemetry_type} from ${instance.id}`);

    // Immediate response to prevent Reporter timeout
    res.status(202).json({ status: 'accepted' });



    // ...

    // Async processing (Fire and forget for Phase 1 V1, or basic await)
    try {
        if (telemetry_type === 'heartbeat') {
            const meta = req.body.instance_metadata || {};
            await query(
                `UPDATE instances SET 
                    last_heartbeat = NOW(), is_active = true,
                    n8n_version = COALESCE($1, n8n_version),
                    database_type = COALESCE($2, database_type),
                    timezone = COALESCE($3, timezone),
                    reporter_version = COALESCE($4, reporter_version)
                 WHERE id = $5`,
                [meta.n8n_version || null, meta.database_type || null,
                 meta.timezone || null, req.body.reporter_version || null, instance.id]
            );
            // Check if reporter is running on a different n8n instance than registered
            if (meta.instance_url) {
                const instResult = await query('SELECT base_url FROM instances WHERE id = $1', [instance.id]);
                const storedUrl = instResult.rows[0]?.base_url;
                if (storedUrl) {
                    const normalize = (u: string) => u.replace(/\/+$/, '').toLowerCase();
                    if (normalize(meta.instance_url) !== normalize(storedUrl)) {
                        await createAlert(
                            AlertType.INSTANCE_URL_MISMATCH,
                            `Reporter for "${instance.name}" is running on ${meta.instance_url} but was registered with ${storedUrl}. The workflow may have been copied to a different instance.`,
                            instance.id,
                            'critical'
                        );
                    } else {
                        // URLs match — auto-resolve any previous mismatch alert
                        await query(
                            `UPDATE alerts SET acknowledged_at = NOW(), acknowledged_by = 'system-auto'
                             WHERE alert_type = $1 AND instance_id = $2 AND acknowledged_at IS NULL`,
                            [AlertType.INSTANCE_URL_MISMATCH, instance.id]
                        );
                    }
                }
            }
            // Check if reporter version is outdated
            if (req.body.reporter_version) {
                await checkReporterVersion(instance.id, instance.name, req.body.reporter_version);
            }
        } else if (telemetry_type === 'configuration') {
            await processConfiguration(instance.id, data);
            // Check workflow thresholds using server-side count after config sync
            const wfResult = await query(
                'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active = true)::int AS active FROM workflows WHERE instance_id = $1',
                [instance.id]
            );
            const { total, active } = wfResult.rows[0];
            await checkWorkflowThresholds(instance.id, instance.name, total, active);
        } else if (telemetry_type === 'executions' || telemetry_type === 'manual') {
            if (data?.executions) {
                await processExecutions(instance.id, data);
            }
        } else if (telemetry_type === 'error') {
            if (data?.error) {
                // Error Trigger data is already normalized by build-payload.js
                // Shape: { id, workflowId, status, startedAt, stoppedAt, error_message, error_node, ... }
                await processExecutions(instance.id, { executions: [data.error] });

                // Auto-fix disabled — see feat/fix-with-ai branch for full implementation
            }
        }
    } catch (error) {
        console.error('Error processing telemetry:', error);
        // Do not respond since we already sent 202
    }
});

export default router;
