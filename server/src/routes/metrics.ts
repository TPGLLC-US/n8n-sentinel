import { Router, Request, Response } from 'express';
import { query } from '../db';
import { runTokenForecast, HourlyBucket } from '../services/forecasting';

const router = Router();

// GET /api/metrics/tokens — aggregated daily view for charts
router.get('/tokens', async (req: Request, res: Response) => {
    try {
        const result = await query(
            `SELECT 
                DATE(tu.recorded_at) as date,
                tu.model,
                tu.provider,
                tu.source,
                w.name as workflow_name,
                SUM(tu.tokens_input) as tokens_input,
                SUM(tu.tokens_output) as tokens_output,
                COUNT(*) as call_count
            FROM token_usage tu
            JOIN executions e ON e.id = tu.execution_id
            JOIN workflows w ON w.id = e.workflow_id
            GROUP BY DATE(tu.recorded_at), tu.model, tu.provider, tu.source, w.name
            ORDER BY date DESC`
        );

        res.json({ metrics: result.rows });
    } catch (error) {
        console.error('Error fetching token metrics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/metrics/tokens/detail — per-execution token rows for datatable
router.get('/tokens/detail', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
        const offset = parseInt(req.query.offset as string) || 0;

        const result = await query(
            `SELECT 
                tu.id,
                tu.recorded_at,
                tu.model,
                tu.provider,
                tu.tokens_input,
                tu.tokens_output,
                tu.accuracy,
                tu.source,
                tu.call_type,
                e.remote_execution_id,
                e.status as execution_status,
                e.started_at as execution_started_at,
                w.name as workflow_name,
                w.remote_id as workflow_remote_id
            FROM token_usage tu
            JOIN executions e ON e.id = tu.execution_id
            JOIN workflows w ON w.id = e.workflow_id
            ORDER BY tu.recorded_at DESC
            LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        const countResult = await query('SELECT COUNT(*) as total FROM token_usage');

        res.json({
            rows: result.rows,
            total: parseInt(countResult.rows[0].total),
            limit,
            offset
        });
    } catch (error) {
        console.error('Error fetching token detail:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/metrics/overview — aggregate stats for the overview dashboard
// Optional query params: ?instance_id=xxx&hours=168
router.get('/overview', async (req: Request, res: Response) => {
    try {
        const instanceId = req.query.instance_id as string | undefined;
        const allowedHours = [1, 12, 24, 168, 720];
        const hours = allowedHours.includes(Number(req.query.hours)) ? Number(req.query.hours) : 168;

        // Time range
        const interval = `${hours} hours`;
        const useHourly = hours <= 24;
        const bucketExpr = useHourly ? `date_trunc('hour', TS)` : `DATE(TS)`;
        const seriesStep = useHourly ? '1 hour' : '1 day';
        const seriesStart = useHourly
            ? `NOW() - INTERVAL '${interval}'`
            : `CURRENT_DATE - INTERVAL '${Math.max(hours / 24 - 1, 0)} days'`;
        const seriesEnd = useHourly ? 'NOW()' : 'CURRENT_DATE';
        const rangeFilter = `NOW() - INTERVAL '${interval}'`;

        // Instance filter fragments
        const wfFilter = instanceId ? 'WHERE instance_id = $1' : '';
        const wfParams = instanceId ? [instanceId] : [];
        const execJoin = instanceId ? 'JOIN workflows w2 ON e.workflow_id = w2.id' : '';
        const execWhere = instanceId ? 'AND w2.instance_id = $1' : '';
        const execParams = instanceId ? [instanceId] : [];
        const tuJoin = instanceId ? 'JOIN executions e2 ON tu.execution_id = e2.id JOIN workflows w2 ON e2.workflow_id = w2.id' : '';
        const tuWhere = instanceId ? 'AND w2.instance_id = $1' : '';

        const eBucket = bucketExpr.replace('TS', 'e.started_at');
        const tuBucket = bucketExpr.replace('TS', 'tu.recorded_at');

        const [workflows, execPeriod, tokensPeriod, trend, errorRateTrend, tokenTrend, topFailing, instanceHealth, execDistribution] = await Promise.all([
            // Total / active workflows
            query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active = true)::int AS active FROM workflows ${wfFilter}`, wfParams),
            // Executions in period
            query(`SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE e.status = 'success')::int AS success,
                COUNT(*) FILTER (WHERE e.status = 'error')::int AS errors
                FROM executions e ${execJoin} WHERE e.started_at >= ${rangeFilter} ${execWhere}`, execParams),
            // Tokens in period
            query(`SELECT
                COALESCE(SUM(tu.tokens_input), 0)::bigint AS input,
                COALESCE(SUM(tu.tokens_output), 0)::bigint AS output
                FROM token_usage tu ${tuJoin} WHERE tu.recorded_at >= ${rangeFilter} ${tuWhere}`, execParams),
            // Execution trend
            query(`SELECT
                d AS date,
                COALESCE(s.total, 0)::int AS total,
                COALESCE(s.success, 0)::int AS success,
                COALESCE(s.errors, 0)::int AS errors
                FROM generate_series(${seriesStart}, ${seriesEnd}, '${seriesStep}'::interval) d
                LEFT JOIN (
                    SELECT ${eBucket} AS bucket,
                        COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE e.status = 'success') AS success,
                        COUNT(*) FILTER (WHERE e.status = 'error') AS errors
                    FROM executions e ${execJoin}
                    WHERE e.started_at >= ${rangeFilter} ${execWhere}
                    GROUP BY bucket
                ) s ON s.bucket = d
                ORDER BY d`, execParams),
            // Error rate trend
            query(`SELECT
                d AS date,
                COALESCE(s.error_rate, 0)::float AS error_rate
                FROM generate_series(${seriesStart}, ${seriesEnd}, '${seriesStep}'::interval) d
                LEFT JOIN (
                    SELECT ${eBucket} AS bucket,
                        CASE WHEN COUNT(*) > 0
                            THEN ROUND(COUNT(*) FILTER (WHERE e.status = 'error') * 100.0 / COUNT(*), 1)
                            ELSE 0 END AS error_rate
                    FROM executions e ${execJoin}
                    WHERE e.started_at >= ${rangeFilter} ${execWhere}
                    GROUP BY bucket
                ) s ON s.bucket = d
                ORDER BY d`, execParams),
            // Token usage trend
            query(`SELECT
                d AS date,
                COALESCE(s.input, 0)::bigint AS input,
                COALESCE(s.output, 0)::bigint AS output
                FROM generate_series(${seriesStart}, ${seriesEnd}, '${seriesStep}'::interval) d
                LEFT JOIN (
                    SELECT ${tuBucket} AS bucket,
                        SUM(tu.tokens_input) AS input,
                        SUM(tu.tokens_output) AS output
                    FROM token_usage tu ${tuJoin}
                    WHERE tu.recorded_at >= ${rangeFilter} ${tuWhere}
                    GROUP BY bucket
                ) s ON s.bucket = d
                ORDER BY d`, execParams),
            // Top 5 failing workflows
            query(`SELECT w.name AS workflow_name, i.name AS instance_name,
                COUNT(*) FILTER (WHERE e.status = 'error')::int AS error_count,
                COUNT(*)::int AS total_count,
                CASE WHEN COUNT(*) > 0
                    THEN ROUND(COUNT(*) FILTER (WHERE e.status = 'error') * 100.0 / COUNT(*), 1)
                    ELSE 0 END AS error_rate
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                JOIN instances i ON w.instance_id = i.id
                WHERE e.started_at >= ${rangeFilter}
                ${instanceId ? 'AND w.instance_id = $1' : ''}
                GROUP BY w.name, i.name
                HAVING COUNT(*) FILTER (WHERE e.status = 'error') > 0
                ORDER BY error_count DESC
                LIMIT 5`, execParams),
            // Instance health — per instance per bucket
            query(`SELECT
                i.id AS instance_id, i.name AS instance_name, d AS date,
                COALESCE(s.total, 0)::int AS total,
                COALESCE(s.errors, 0)::int AS errors,
                COALESCE(s.error_rate, 0)::float AS error_rate
                FROM instances i
                CROSS JOIN generate_series(${seriesStart}, ${seriesEnd}, '${seriesStep}'::interval) d
                LEFT JOIN (
                    SELECT w.instance_id, ${eBucket} AS bucket,
                        COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE e.status = 'error') AS errors,
                        CASE WHEN COUNT(*) > 0
                            THEN ROUND(COUNT(*) FILTER (WHERE e.status = 'error') * 100.0 / COUNT(*), 1)
                            ELSE 0 END AS error_rate
                    FROM executions e
                    JOIN workflows w ON e.workflow_id = w.id
                    WHERE e.started_at >= ${rangeFilter}
                    GROUP BY w.instance_id, bucket
                ) s ON s.instance_id = i.id AND s.bucket = d
                WHERE i.is_active = true
                ${instanceId ? 'AND i.id = $1' : ''}
                ORDER BY i.name, d`, instanceId ? [instanceId] : []),
            // Execution distribution by instance
            query(`SELECT i.name AS instance_name,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE e.status = 'success')::int AS success,
                COUNT(*) FILTER (WHERE e.status = 'error')::int AS errors
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                JOIN instances i ON w.instance_id = i.id
                WHERE e.started_at >= ${rangeFilter}
                ${instanceId ? 'AND w.instance_id = $1' : ''}
                GROUP BY i.name
                ORDER BY total DESC`, execParams),
        ]);

        res.json({
            workflows: workflows.rows[0],
            executionsPeriod: execPeriod.rows[0],
            tokensPeriod: tokensPeriod.rows[0],
            executionTrend: trend.rows,
            errorRateTrend: errorRateTrend.rows,
            tokenTrend: tokenTrend.rows,
            topFailingWorkflows: topFailing.rows,
            instanceHealth: instanceHealth.rows,
            execDistribution: execDistribution.rows,
            hours,
        });
    } catch (error) {
        console.error('Error fetching overview metrics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/metrics/forecast/tokens — token usage forecast with Holt-Winters + baselines
// Optional query params: ?instance_id=xxx&history_hours=168&forecast_hours=24
router.get('/forecast/tokens', async (req: Request, res: Response) => {
    try {
        const instanceId = req.query.instance_id as string | undefined;
        const historyHours = Math.min(Math.max(Number(req.query.history_hours) || 168, 48), 720);
        const forecastHours = Math.min(Math.max(Number(req.query.forecast_hours) || 24, 1), 168);

        const instJoin = instanceId
            ? 'JOIN executions e2 ON tu.execution_id = e2.id JOIN workflows w2 ON e2.workflow_id = w2.id'
            : '';
        const instWhere = instanceId ? 'AND w2.instance_id = $1' : '';
        const params = instanceId ? [instanceId] : [];

        const result = await query(`
            SELECT
                date_trunc('hour', tu.recorded_at) AS hour,
                COALESCE(SUM(tu.tokens_input), 0)::bigint AS input,
                COALESCE(SUM(tu.tokens_output), 0)::bigint AS output
            FROM token_usage tu
            ${instJoin}
            WHERE tu.recorded_at >= NOW() - INTERVAL '${historyHours} hours'
            ${instWhere}
            GROUP BY date_trunc('hour', tu.recorded_at)
            ORDER BY hour
        `, params);

        // Fill gaps — ensure every hour has a bucket
        const rows = result.rows as { hour: string; input: string; output: string }[];
        const bucketMap = new Map<string, { input: number; output: number }>();
        for (const r of rows) {
            const key = new Date(r.hour).toISOString();
            bucketMap.set(key, { input: Number(r.input), output: Number(r.output) });
        }

        const now = new Date();
        const startHour = new Date(now.getTime() - historyHours * 3600000);
        startHour.setMinutes(0, 0, 0);
        const buckets: HourlyBucket[] = [];
        for (let t = startHour.getTime(); t <= now.getTime(); t += 3600000) {
            const dt = new Date(t);
            const key = dt.toISOString();
            const vals = bucketMap.get(key) || { input: 0, output: 0 };
            buckets.push({
                hour: key,
                input: vals.input,
                output: vals.output,
                total: vals.input + vals.output,
            });
        }

        const forecast = runTokenForecast(buckets, forecastHours);

        res.json(forecast);
    } catch (error) {
        console.error('Error generating token forecast:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
