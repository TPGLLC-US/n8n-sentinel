import { schedule as cronSchedule, ScheduledTask } from 'node-cron';
import { query } from '../db';
import { getSetting } from '../routes/settings';

// Default retention periods (days)
const DEFAULT_EXECUTIONS_DAYS = 90;
const DEFAULT_ALERTS_DAYS = 90;
const DEFAULT_TOKEN_USAGE_DAYS = 90;
const MIN_RETENTION_DAYS = 10;
const MAX_RETENTION_DAYS = 90;

let nonceCleanupJob: ScheduledTask | null = null;
let dailyCleanupJob: ScheduledTask | null = null;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

async function getRetentionDays(key: string, defaultDays: number): Promise<number> {
    const val = await getSetting(key);
    if (!val) return defaultDays;
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) return defaultDays;
    return clamp(parsed, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
}

/**
 * Clean expired nonces (every 10 minutes per PRD §14.2)
 */
async function cleanExpiredNonces(): Promise<number> {
    const result = await query('DELETE FROM nonce_cache WHERE expires_at < NOW()');
    return result.rowCount ?? 0;
}

/**
 * Aggregate daily metrics before deleting old executions.
 * Upserts into daily_metrics for the date range about to be cleaned.
 */
async function aggregateDailyMetrics(retentionDays: number): Promise<void> {
    await query(`
        INSERT INTO daily_metrics (instance_id, date, total_executions, successful_executions, failed_executions, total_tokens_input, total_tokens_output, unique_workflows_run)
        SELECT
            w.instance_id,
            DATE(e.started_at) as date,
            COUNT(*) as total_executions,
            COUNT(*) FILTER (WHERE e.status = 'success') as successful_executions,
            COUNT(*) FILTER (WHERE e.status = 'error') as failed_executions,
            COALESCE(SUM(t.tokens_input), 0) as total_tokens_input,
            COALESCE(SUM(t.tokens_output), 0) as total_tokens_output,
            COUNT(DISTINCT e.workflow_id) as unique_workflows_run
        FROM executions e
        JOIN workflows w ON e.workflow_id = w.id
        LEFT JOIN token_usage t ON e.id = t.execution_id
        WHERE e.created_at < NOW() - INTERVAL '1 day' * $1
        GROUP BY w.instance_id, DATE(e.started_at)
        ON CONFLICT (instance_id, date) DO UPDATE SET
            total_executions = EXCLUDED.total_executions,
            successful_executions = EXCLUDED.successful_executions,
            failed_executions = EXCLUDED.failed_executions,
            total_tokens_input = EXCLUDED.total_tokens_input,
            total_tokens_output = EXCLUDED.total_tokens_output,
            unique_workflows_run = EXCLUDED.unique_workflows_run
    `, [retentionDays]);
}

/**
 * Delete old executions (cascades to token_usage via FK)
 */
async function cleanOldExecutions(days: number): Promise<number> {
    const result = await query(
        'DELETE FROM executions WHERE created_at < NOW() - INTERVAL \'1 day\' * $1',
        [days]
    );
    return result.rowCount ?? 0;
}

/**
 * Delete old acknowledged alerts
 */
async function cleanOldAlerts(days: number): Promise<number> {
    const result = await query(
        'DELETE FROM alerts WHERE triggered_at < NOW() - INTERVAL \'1 day\' * $1 AND acknowledged_at IS NOT NULL',
        [days]
    );
    return result.rowCount ?? 0;
}

/**
 * Delete orphaned token_usage rows (shouldn't exist with FK cascade, but safety net)
 */
async function cleanOrphanedTokenUsage(days: number): Promise<number> {
    const result = await query(
        'DELETE FROM token_usage WHERE recorded_at < NOW() - INTERVAL \'1 day\' * $1 AND execution_id NOT IN (SELECT id FROM executions)',
        [days]
    );
    return result.rowCount ?? 0;
}

/**
 * Run the full daily cleanup cycle
 */
async function runDailyCleanup(): Promise<void> {
    const startTime = Date.now();
    console.log('[data-retention] Starting daily cleanup...');

    try {
        const execDays = await getRetentionDays('retention_executions_days', DEFAULT_EXECUTIONS_DAYS);
        const alertDays = await getRetentionDays('retention_alerts_days', DEFAULT_ALERTS_DAYS);
        const tokenDays = await getRetentionDays('retention_token_usage_days', DEFAULT_TOKEN_USAGE_DAYS);

        // Aggregate before deleting
        await aggregateDailyMetrics(execDays);
        console.log('[data-retention] Daily metrics aggregated');

        const execDeleted = await cleanOldExecutions(execDays);
        console.log(`[data-retention] Cleaned ${execDeleted} executions older than ${execDays} days`);

        const alertsDeleted = await cleanOldAlerts(alertDays);
        console.log(`[data-retention] Cleaned ${alertsDeleted} acknowledged alerts older than ${alertDays} days`);

        const tokenDeleted = await cleanOrphanedTokenUsage(tokenDays);
        if (tokenDeleted > 0) {
            console.log(`[data-retention] Cleaned ${tokenDeleted} orphaned token_usage rows`);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[data-retention] Daily cleanup completed in ${elapsed}s`);
    } catch (error) {
        console.error('[data-retention] Daily cleanup failed:', error);
    }
}

/**
 * Start data retention scheduled jobs.
 * - Nonce cleanup: every 10 minutes
 * - Daily cleanup: 2:00 AM UTC
 */
export function startDataRetention(): void {
    stopDataRetention();

    // Nonce cleanup every 10 minutes
    nonceCleanupJob = cronSchedule('*/10 * * * *', async () => {
        try {
            const deleted = await cleanExpiredNonces();
            if (deleted > 0) {
                console.log(`[data-retention] Cleaned ${deleted} expired nonces`);
            }
        } catch (error) {
            console.error('[data-retention] Nonce cleanup failed:', error);
        }
    }, { timezone: 'UTC' });

    // Daily cleanup at 2:00 AM UTC
    dailyCleanupJob = cronSchedule('0 2 * * *', runDailyCleanup, { timezone: 'UTC' });

    console.log('[data-retention] Scheduled: nonce cleanup (every 10min), daily cleanup (02:00 UTC)');
}

export function stopDataRetention(): void {
    if (nonceCleanupJob) { nonceCleanupJob.stop(); nonceCleanupJob = null; }
    if (dailyCleanupJob) { dailyCleanupJob.stop(); dailyCleanupJob = null; }
}

// Export for manual trigger / testing
export { runDailyCleanup, cleanExpiredNonces };
