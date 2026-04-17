import { query } from '../db';
import { getSetting } from '../routes/settings';
import { getResendClient, getFromEmail, getRecipients } from './resend';
import { renderAlertNotification } from '../emails/AlertNotification';

export const LATEST_REPORTER_VERSION = '1.4.0';

export const AlertType = {
    MISSED_HEARTBEAT: 'heartbeat_missed',
    HIGH_ERROR_RATE: 'error_rate_high',
    WORKFLOW_COUNT_ZERO: 'workflow_count_zero',
    WORKFLOW_COUNT_DROP: 'workflow_count_drop',
    WORKFLOW_COUNT_SPIKE: 'workflow_count_spike',
    INSTANCE_URL_MISMATCH: 'instance_url_mismatch',
    REPORTER_OUTDATED: 'reporter_outdated',
    INGEST_TOKEN_ROTATED: 'ingest_token_rotated',
    HEARTBEAT_AFTER_ROTATION: 'heartbeat_after_rotation'
};

export function createAlertInsertQuery(): string {
    return `INSERT INTO alerts (alert_type, severity, message, instance_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
            RETURNING id, triggered_at`;
}

export async function createAlert(alertType: string, message: string, instanceId: string, severity: string = 'warning') {
    const result = await query(createAlertInsertQuery(), [alertType, severity, message, instanceId]);
    if (result.rows.length === 0) {
        return; // Duplicate active alert — ignored by the partial unique index.
    }
    console.log(`CREATED ALERT: [${alertType}] ${message}`);
    sendAlertEmail(alertType, severity, message, instanceId, result.rows[0].triggered_at).catch((err: any) => {
        console.error('[alert-email] Failed to send:', err.message);
        recordEmailFailure({
            alertType, severity, message, instanceId,
            triggeredAt: new Date(result.rows[0].triggered_at),
            errorMessage: err?.message || String(err),
        });
    });
}

export async function getActiveAlerts() {
    const res = await query(`
        SELECT a.*, i.name as instance_name 
        FROM alerts a
        LEFT JOIN instances i ON a.instance_id = i.id
        WHERE acknowledged_at IS NULL
        ORDER BY triggered_at DESC
    `);
    return res.rows;
}

export async function resolveAlert(id: string, userId?: string) {
    await query(
        `UPDATE alerts SET acknowledged_at = NOW(), acknowledged_by = $2 WHERE id = $1`,
        [id, userId || null]
    );
}

// --- CHECKS ---

export async function checkHeartbeats() {
    console.log('Running Heartbeat Check...');
    // Find instances active but last_heartbeat > 5 mins ago
    const res = await query(`
        SELECT id, name, last_heartbeat 
        FROM instances 
        WHERE is_active = TRUE 
        AND last_heartbeat < NOW() - INTERVAL '5 minutes'
    `);

    for (const inst of res.rows) {
        await createAlert(
            AlertType.MISSED_HEARTBEAT,
            `Instance "${inst.name}" has not reported in for over 5 minutes.`,
            inst.id as string
        );
    }

    // Check for instances that went offline within 24h of an ingest token rotation
    // This suggests the reporter workflow wasn't updated with the new URL
    const rotationMissed = await query(`
        SELECT i.id, i.name, i.last_heartbeat,
               a.triggered_at as rotation_alert_time
        FROM instances i
        JOIN alerts a ON a.instance_id = i.id
            AND a.alert_type = $1
            AND a.triggered_at > NOW() - INTERVAL '24 hours'
        WHERE i.is_active = TRUE
        AND i.last_heartbeat < NOW() - INTERVAL '5 minutes'
        AND i.last_heartbeat < a.triggered_at
    `, [AlertType.INGEST_TOKEN_ROTATED]);

    for (const inst of rotationMissed.rows) {
        await createAlert(
            AlertType.HEARTBEAT_AFTER_ROTATION,
            `Instance "${inst.name}" went offline after an ingest token rotation. Did you update the reporter workflow with the new webhook URL?`,
            inst.id as string,
            'critical'
        );
    }
}

// Placeholder for error rate check (requires aggregating execution logs)
export async function checkErrorRates() {
    // console.log('Running Error Rate Check... (Not implemented yet)');
}

// --- WORKFLOW THRESHOLD CHECKS ---

const THRESHOLD_DROP_PERCENT = 20; // Alert if workflows drop > 20% below baseline
const THRESHOLD_SPIKE_PERCENT = 50; // Alert if workflows grow > 50% above baseline

export async function checkWorkflowThresholds(
    instanceId: string, instanceName: string, currentCount: number, activeCount?: number
) {
    // Load baseline from instances table
    const res = await query(
        'SELECT baseline_workflow_count FROM instances WHERE id = $1',
        [instanceId]
    );
    if (res.rows.length === 0) return;

    const baseline = res.rows[0].baseline_workflow_count;
    if (baseline === null || baseline === undefined) return; // No baseline set, skip

    // Check: workflows dropped to zero
    if (currentCount === 0 && baseline > 0) {
        await createAlert(
            AlertType.WORKFLOW_COUNT_ZERO,
            `Instance "${instanceName}" has 0 workflows (baseline: ${baseline}). All workflows may have been deleted.`,
            instanceId,
            'critical'
        );
        return;
    } else {
        await autoResolveAlert(AlertType.WORKFLOW_COUNT_ZERO, instanceId);
    }

    // Check: workflows dropped significantly
    if (baseline > 0) {
        const dropPercent = ((baseline - currentCount) / baseline) * 100;
        if (dropPercent > THRESHOLD_DROP_PERCENT) {
            await createAlert(
                AlertType.WORKFLOW_COUNT_DROP,
                `Instance "${instanceName}" workflow count dropped ${dropPercent.toFixed(0)}% (${currentCount} vs baseline ${baseline}).`,
                instanceId,
                'warning'
            );
        } else {
            await autoResolveAlert(AlertType.WORKFLOW_COUNT_DROP, instanceId);
        }

        // Check: workflows spiked significantly
        const spikePercent = ((currentCount - baseline) / baseline) * 100;
        if (spikePercent > THRESHOLD_SPIKE_PERCENT) {
            await createAlert(
                AlertType.WORKFLOW_COUNT_SPIKE,
                `Instance "${instanceName}" workflow count spiked ${spikePercent.toFixed(0)}% (${currentCount} vs baseline ${baseline}).`,
                instanceId,
                'info'
            );
        } else {
            await autoResolveAlert(AlertType.WORKFLOW_COUNT_SPIKE, instanceId);
        }
    }
}

async function autoResolveAlert(alertType: string, instanceId: string) {
    await query(
        `UPDATE alerts SET acknowledged_at = NOW()
         WHERE alert_type = $1 AND instance_id = $2 AND acknowledged_at IS NULL`,
        [alertType, instanceId]
    );
}

// Returns how many minor/patch versions behind (simple semver comparison)
function versionsBehind(current: string, latest: string): number {
    const parse = (v: string) => v.split('.').map(Number);
    const [cMaj, cMin, cPatch] = parse(current);
    const [lMaj, lMin, lPatch] = parse(latest);
    if (cMaj < lMaj) return (lMaj - cMaj) * 100 + lMin - cMin; // major gap
    if (cMin < lMin) return lMin - cMin;
    if (cPatch < lPatch) return 1; // patch behind counts as 1
    return 0;
}

export async function checkReporterVersion(instanceId: string, instanceName: string, reporterVersion: string) {
    if (!reporterVersion) return;
    const behind = versionsBehind(reporterVersion, LATEST_REPORTER_VERSION);
    if (behind > 0) {
        await createAlert(
            AlertType.REPORTER_OUTDATED,
            `Instance "${instanceName}" is running reporter ${reporterVersion} (latest: ${LATEST_REPORTER_VERSION}). Please update to get the latest features.`,
            instanceId,
            'warning'
        );
    } else {
        await autoResolveAlert(AlertType.REPORTER_OUTDATED, instanceId);
    }
}

// ─── Alert Email Notification ────────────────────────────────────────────────

async function sendAlertEmail(
    alertType: string,
    severity: string,
    message: string,
    instanceId: string,
    triggeredAt: string
): Promise<void> {
    // Check if alert emails are enabled
    const enabled = await getSetting('alert_email_enabled');
    if (enabled !== 'true') return;

    // Check if this alert type is in the user's enabled types
    const enabledTypes = await getSetting('alert_email_types');
    if (enabledTypes) {
        const types = enabledTypes.split(',').map(t => t.trim());
        if (!types.includes(alertType)) return;
    }

    // Get instance name
    const instResult = await query('SELECT name FROM instances WHERE id = $1', [instanceId]);
    const instanceName = instResult.rows[0]?.name || 'Unknown';

    // Render email
    const html = await renderAlertNotification({
        alertType,
        severity,
        message,
        instanceName,
        triggeredAt: triggeredAt || new Date().toISOString(),
    });

    // Send via Resend
    const resend = await getResendClient();
    const from = await getFromEmail();
    const recipients = await getRecipients();

    const subjectPrefix = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
    const typeLabel = alertTypeLabels[alertType] || alertType;

    await resend.emails.send({
        from,
        to: recipients,
        subject: `${subjectPrefix} [Sentinel ${severity.toUpperCase()}] ${typeLabel} — ${instanceName}`,
        html,
    });

    console.log(`[alert-email] Sent ${alertType} alert for ${instanceName} to ${recipients.join(', ')}`);
}

const alertTypeLabels: Record<string, string> = {
    heartbeat_missed: 'Missed Heartbeat',
    error_rate_high: 'High Error Rate',
    workflow_count_zero: 'Zero Workflows',
    workflow_count_drop: 'Workflow Count Drop',
    workflow_count_spike: 'Workflow Count Spike',
    instance_url_mismatch: 'Instance URL Mismatch',
    reporter_outdated: 'Reporter Outdated',
};

interface EmailFailureRecord {
    alertType: string;
    severity: string;
    message: string;
    instanceId: string;
    triggeredAt: Date;
    errorMessage: string;
}

export const recordEmailFailure = Object.assign(
    async function (rec: EmailFailureRecord): Promise<void> {
        const { sql, values } = recordEmailFailure.buildQuery(rec);
        await query(sql, values).catch(err => {
            console.error('[alert-email] Failed to persist failure record:', err);
        });
    },
    {
        buildQuery(rec: EmailFailureRecord) {
            return {
                sql: `INSERT INTO alert_email_attempts
                      (alert_type, severity, message, instance_id, triggered_at, status, error_message)
                      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                values: [rec.alertType, rec.severity, rec.message, rec.instanceId, rec.triggeredAt, 'failed', rec.errorMessage],
            };
        },
    }
);
