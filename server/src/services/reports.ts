import { query } from '../db';
import { getResendClient, getFromEmail, getRecipients } from './resend';
import { renderMonitoringReport } from '../emails/MonitoringReport';
import { getSetting } from '../routes/settings';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InstanceStats {
    instance_id: string;
    instance_name: string;
    status: string;
    last_heartbeat: string | null;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    errorRate: number;
    topFailingWorkflows: { workflow_name: string; error_count: number }[];
    topFailingNodes: { error_node: string; error_count: number }[];
    diagnosed: number;
    totalTokensInput: number;
    totalTokensOutput: number;
    activeAlerts: number;
    newAlerts: { alert_type: string; message: string; triggered_at: string }[];
}

export interface ReportData {
    period: 'daily' | 'weekly' | 'monthly';
    dateRange: { from: string; to: string };

    // Executions
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    errorRate: number;

    // Errors
    newErrors: number;
    topFailingWorkflows: { workflow_name: string; error_count: number }[];
    topFailingNodes: { error_node: string; error_count: number }[];

    // Diagnosis
    diagnosed: number;
    feedbackUp: number;
    feedbackDown: number;

    // Token Usage
    totalTokensInput: number;
    totalTokensOutput: number;
    estimatedCost: number;
    topModels: { model: string; total_tokens: number }[];

    // Instances
    instances: { name: string; status: string; last_heartbeat: string | null }[];

    // Alerts
    activeAlerts: number;
    newAlerts: { alert_type: string; message: string; instance_name: string; triggered_at: string }[];

    // Per-instance breakdown (optional)
    instanceBreakdown?: InstanceStats[];
}

// ─── Date Range Helpers ──────────────────────────────────────────────────────

function getDateRange(period: 'daily' | 'weekly' | 'monthly'): { from: Date; to: Date; interval: string } {
    const to = new Date();
    const from = new Date();

    switch (period) {
        case 'daily':
            from.setDate(from.getDate() - 1);
            return { from, to, interval: '24 hours' };
        case 'weekly':
            from.setDate(from.getDate() - 7);
            return { from, to, interval: '7 days' };
        case 'monthly':
            from.setMonth(from.getMonth() - 1);
            return { from, to, interval: '30 days' };
    }
}

// ─── Data Gathering ──────────────────────────────────────────────────────────

export async function gatherReportData(period: 'daily' | 'weekly' | 'monthly', includeInstanceBreakdown: boolean = false): Promise<ReportData> {
    const { from, to, interval } = getDateRange(period);

    const [
        execStats,
        topWorkflows,
        topNodes,
        diagStats,
        tokenStats,
        topModels,
        instances,
        activeAlertCount,
        newAlerts,
    ] = await Promise.all([
        // Execution stats
        query(`
            SELECT
                COUNT(*)::int as total,
                COUNT(*) FILTER (WHERE status = 'success')::int as successful,
                COUNT(*) FILTER (WHERE status = 'error')::int as failed
            FROM executions
            WHERE started_at >= NOW() - $1::interval
        `, [interval]),

        // Top failing workflows
        query(`
            SELECT w.name as workflow_name, COUNT(*)::int as error_count
            FROM executions e
            JOIN workflows w ON e.workflow_id = w.id
            WHERE e.status = 'error' AND e.started_at >= NOW() - $1::interval
            GROUP BY w.name
            ORDER BY error_count DESC
            LIMIT 5
        `, [interval]),

        // Top failing nodes
        query(`
            SELECT error_node, COUNT(*)::int as error_count
            FROM executions
            WHERE status = 'error' AND error_node IS NOT NULL
              AND started_at >= NOW() - $1::interval
            GROUP BY error_node
            ORDER BY error_count DESC
            LIMIT 5
        `, [interval]),

        // Diagnosis stats
        query(`
            SELECT
                COUNT(*) FILTER (WHERE ai_diagnosis IS NOT NULL)::int as diagnosed,
                (SELECT COUNT(*)::int FROM diagnosis_feedback
                 WHERE rating = 'up' AND created_at >= NOW() - $1::interval) as feedback_up,
                (SELECT COUNT(*)::int FROM diagnosis_feedback
                 WHERE rating = 'down' AND created_at >= NOW() - $1::interval) as feedback_down
            FROM executions
            WHERE status = 'error' AND started_at >= NOW() - $1::interval
        `, [interval]),

        // Token usage totals
        query(`
            SELECT
                COALESCE(SUM(tokens_input), 0)::bigint as total_input,
                COALESCE(SUM(tokens_output), 0)::bigint as total_output
            FROM token_usage
            WHERE recorded_at >= NOW() - $1::interval
        `, [interval]),

        // Top models by usage
        query(`
            SELECT model, SUM(tokens_input + tokens_output)::bigint as total_tokens
            FROM token_usage
            WHERE recorded_at >= NOW() - $1::interval AND model IS NOT NULL AND model != 'unknown'
            GROUP BY model
            ORDER BY total_tokens DESC
            LIMIT 5
        `, [interval]),

        // Instance health
        query(`
            SELECT name, 
                   CASE WHEN is_active AND last_heartbeat >= NOW() - INTERVAL '5 minutes' THEN 'healthy'
                        WHEN is_active AND last_heartbeat >= NOW() - INTERVAL '15 minutes' THEN 'degraded'
                        WHEN is_active THEN 'offline'
                        ELSE 'inactive' END as status,
                   last_heartbeat
            FROM instances
            ORDER BY name ASC
        `),

        // Active alerts count
        query(`
            SELECT COUNT(*)::int as count
            FROM alerts
            WHERE acknowledged_at IS NULL
        `),

        // New alerts in period
        query(`
            SELECT a.alert_type, a.message, COALESCE(i.name, 'Unknown') as instance_name, a.triggered_at
            FROM alerts a
            LEFT JOIN instances i ON a.instance_id = i.id
            WHERE a.triggered_at >= NOW() - $1::interval
            ORDER BY a.triggered_at DESC
            LIMIT 10
        `, [interval]),
    ]);

    const exec = execStats.rows[0];
    const diag = diagStats.rows[0];
    const tokens = tokenStats.rows[0];
    const totalExecs = exec?.total || 0;
    const failedExecs = exec?.failed || 0;

    const reportData: ReportData = {
        period,
        dateRange: { from: from.toISOString(), to: to.toISOString() },
        totalExecutions: totalExecs,
        successfulExecutions: exec?.successful || 0,
        failedExecutions: failedExecs,
        errorRate: totalExecs > 0 ? parseFloat(((failedExecs / totalExecs) * 100).toFixed(1)) : 0,
        newErrors: failedExecs,
        topFailingWorkflows: topWorkflows.rows,
        topFailingNodes: topNodes.rows,
        diagnosed: parseInt(diag?.diagnosed) || 0,
        feedbackUp: parseInt(diag?.feedback_up) || 0,
        feedbackDown: parseInt(diag?.feedback_down) || 0,
        totalTokensInput: parseInt(tokens?.total_input) || 0,
        totalTokensOutput: parseInt(tokens?.total_output) || 0,
        estimatedCost: 0,
        topModels: topModels.rows.map(r => ({ model: r.model, total_tokens: parseInt(r.total_tokens) })),
        instances: instances.rows,
        activeAlerts: activeAlertCount.rows[0]?.count || 0,
        newAlerts: newAlerts.rows,
    };

    // Per-instance breakdown
    if (includeInstanceBreakdown && instances.rows.length > 0) {
        reportData.instanceBreakdown = await gatherInstanceBreakdowns(interval, instances.rows);
    }

    return reportData;
}

async function gatherInstanceBreakdowns(interval: string, instanceList: any[]): Promise<InstanceStats[]> {
    // Get all instance IDs for parallel queries
    const allInstances = await query(`SELECT id, name, is_active, last_heartbeat FROM instances ORDER BY name ASC`);

    const breakdowns: InstanceStats[] = [];

    for (const inst of allInstances.rows) {
        const [execRes, wfRes, nodeRes, diagRes, tokenRes, alertCountRes, alertsRes] = await Promise.all([
            query(`
                SELECT COUNT(*)::int as total,
                       COUNT(*) FILTER (WHERE e.status = 'success')::int as successful,
                       COUNT(*) FILTER (WHERE e.status = 'error')::int as failed
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                WHERE w.instance_id = $1 AND e.started_at >= NOW() - $2::interval
            `, [inst.id, interval]),
            query(`
                SELECT w.name as workflow_name, COUNT(*)::int as error_count
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                WHERE e.status = 'error' AND w.instance_id = $1 AND e.started_at >= NOW() - $2::interval
                GROUP BY w.name ORDER BY error_count DESC LIMIT 5
            `, [inst.id, interval]),
            query(`
                SELECT e.error_node, COUNT(*)::int as error_count
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                WHERE e.status = 'error' AND e.error_node IS NOT NULL
                  AND w.instance_id = $1 AND e.started_at >= NOW() - $2::interval
                GROUP BY e.error_node ORDER BY error_count DESC LIMIT 3
            `, [inst.id, interval]),
            query(`
                SELECT COUNT(*) FILTER (WHERE e.ai_diagnosis IS NOT NULL)::int as diagnosed
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                WHERE e.status = 'error' AND w.instance_id = $1 AND e.started_at >= NOW() - $2::interval
            `, [inst.id, interval]),
            query(`
                SELECT COALESCE(SUM(tu.tokens_input), 0)::bigint as total_input,
                       COALESCE(SUM(tu.tokens_output), 0)::bigint as total_output
                FROM token_usage tu
                JOIN executions e ON e.id = tu.execution_id
                JOIN workflows w ON w.id = e.workflow_id
                WHERE w.instance_id = $1 AND tu.recorded_at >= NOW() - $2::interval
            `, [inst.id, interval]),
            query(`
                SELECT COUNT(*)::int as count FROM alerts
                WHERE instance_id = $1 AND acknowledged_at IS NULL
            `, [inst.id]),
            query(`
                SELECT alert_type, message, triggered_at FROM alerts
                WHERE instance_id = $1 AND triggered_at >= NOW() - $2::interval
                ORDER BY triggered_at DESC LIMIT 5
            `, [inst.id, interval]),
        ]);

        const e = execRes.rows[0];
        const total = e?.total || 0;
        const failed = e?.failed || 0;
        const matchingInst = instanceList.find((i: any) => i.name === inst.name);

        breakdowns.push({
            instance_id: inst.id,
            instance_name: inst.name,
            status: matchingInst?.status || (inst.is_active ? 'offline' : 'inactive'),
            last_heartbeat: inst.last_heartbeat,
            totalExecutions: total,
            successfulExecutions: e?.successful || 0,
            failedExecutions: failed,
            errorRate: total > 0 ? parseFloat(((failed / total) * 100).toFixed(1)) : 0,
            topFailingWorkflows: wfRes.rows,
            topFailingNodes: nodeRes.rows,
            diagnosed: parseInt(diagRes.rows[0]?.diagnosed) || 0,
            totalTokensInput: parseInt(tokenRes.rows[0]?.total_input) || 0,
            totalTokensOutput: parseInt(tokenRes.rows[0]?.total_output) || 0,
            activeAlerts: alertCountRes.rows[0]?.count || 0,
            newAlerts: alertsRes.rows,
        });
    }

    return breakdowns;
}

// ─── Send Report ─────────────────────────────────────────────────────────────

interface SendReportOptions {
    period: 'daily' | 'weekly' | 'monthly';
    triggeredBy?: 'scheduler' | 'manual' | 'test';
    recipientOverride?: string[]; // For test sends
}

export async function sendReport(options: SendReportOptions): Promise<{ success: boolean; resendId?: string; error?: string }> {
    const { period, triggeredBy = 'manual', recipientOverride } = options;

    try {
        // Check if instance breakdown is enabled
        const breakdownSetting = await getSetting('report_instance_breakdown');
        const includeBreakdown = breakdownSetting === 'true';

        // Gather data
        const data = await gatherReportData(period, includeBreakdown);

        // Render email
        const html = await renderMonitoringReport(data);

        // Get config
        const resend = await getResendClient();
        const fromEmail = await getFromEmail();
        const recipients = recipientOverride || await getRecipients();

        const periodLabel = period.charAt(0).toUpperCase() + period.slice(1);
        const subject = `Sentinel ${periodLabel} Report — ${new Date().toLocaleDateString()}`;

        // Send via Resend
        const { data: sendData, error: sendError } = await resend.emails.send({
            from: fromEmail,
            to: recipients,
            subject,
            html,
        });

        if (sendError) {
            // Log failure
            await query(
                `INSERT INTO report_history (period, recipients, subject, status, error_message, date_from, date_to, triggered_by)
                 VALUES ($1, $2, $3, 'failed', $4, $5, $6, $7)`,
                [period, recipients, subject, sendError.message, data.dateRange.from, data.dateRange.to, triggeredBy]
            );
            console.error(`[reports] Failed to send ${period} report:`, sendError.message);
            return { success: false, error: sendError.message };
        }

        // Log success
        await query(
            `INSERT INTO report_history (period, recipients, subject, status, resend_id, report_data, date_from, date_to, triggered_by)
             VALUES ($1, $2, $3, 'sent', $4, $5, $6, $7, $8)`,
            [period, recipients, subject, sendData?.id, JSON.stringify(data), data.dateRange.from, data.dateRange.to, triggeredBy]
        );

        console.log(`[reports] Sent ${period} report to ${recipients.join(', ')} (resend_id: ${sendData?.id})`);
        return { success: true, resendId: sendData?.id };

    } catch (err: any) {
        console.error(`[reports] Error sending ${period} report:`, err.message);

        // Log failure
        try {
            await query(
                `INSERT INTO report_history (period, recipients, subject, status, error_message, date_from, date_to, triggered_by)
                 VALUES ($1, $2, $3, 'failed', $4, NOW() - INTERVAL '1 day', NOW(), $5)`,
                [period, ['error'], `Sentinel Report (failed)`, err.message, triggeredBy]
            );
        } catch { /* ignore logging failure */ }

        return { success: false, error: err.message };
    }
}
