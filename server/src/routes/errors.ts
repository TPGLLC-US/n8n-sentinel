import { Router, Request, Response } from 'express';
import { query } from '../db';
import { attemptAiFix, diagnoseError, complexDiagnoseError, enrichErrorDetails } from '../services/ai-fix';
import { validateUUID } from '../middleware/validate';
import { diagnosisLimiter } from '../middleware/rate-limit';

const router = Router();

// GET /api/errors - List errors with enriched data
router.get('/', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const instanceId = req.query.instance_id as string;
        const since = req.query.since as string; // ISO date string

        let whereClause = "WHERE e.status = 'error'";
        const params: any[] = [];
        let paramIdx = 1;

        if (instanceId) {
            whereClause += ` AND i.id = $${paramIdx++}`;
            params.push(instanceId);
        }
        if (since) {
            whereClause += ` AND e.started_at >= $${paramIdx++}`;
            params.push(since);
        }

        whereClause += ` ORDER BY e.started_at DESC LIMIT $${paramIdx++}`;
        params.push(limit);

        const result = await query(`
            SELECT 
                e.id,
                e.remote_execution_id,
                e.status,
                e.started_at,
                e.finished_at,
                e.duration_ms,
                e.error_message,
                e.error_node,
                e.ai_diagnosis,
                w.name as workflow_name,
                w.remote_id as workflow_remote_id,
                w.node_count,
                i.id as instance_id,
                i.name as instance_name,
                i.base_url,
                i.n8n_api_key_encrypted IS NOT NULL as has_api_key,
                (SELECT afa.status FROM ai_fix_attempts afa 
                 WHERE afa.execution_id = e.id 
                 ORDER BY afa.created_at DESC LIMIT 1) as ai_fix_status,
                (SELECT df.rating FROM diagnosis_feedback df
                 WHERE df.execution_id = e.id
                 ORDER BY df.created_at DESC LIMIT 1) as diagnosis_feedback_rating
            FROM executions e
            JOIN workflows w ON e.workflow_id = w.id
            JOIN instances i ON w.instance_id = i.id
            ${whereClause}
        `, params);

        res.json({ errors: result.rows });
    } catch (error) {
        console.error('Error fetching errors:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/errors/stats - Aggregate error statistics
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const instanceId = req.query.instance_id as string;
        const instanceFilter = instanceId ? 'AND i.id = $1' : '';
        const params = instanceId ? [instanceId] : [];

        // Parallel queries for stats
        const [errors24h, errors7d, topWorkflows, topNodes, diagnosisStats] = await Promise.all([
            // Errors in last 24h
            query(`
                SELECT COUNT(*)::int as count,
                       COUNT(DISTINCT w.id)::int as unique_workflows
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                JOIN instances i ON w.instance_id = i.id
                WHERE e.status = 'error' AND e.started_at >= NOW() - INTERVAL '24 hours'
                ${instanceFilter}
            `, params),

            // Errors in last 7d
            query(`
                SELECT COUNT(*)::int as count
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                JOIN instances i ON w.instance_id = i.id
                WHERE e.status = 'error' AND e.started_at >= NOW() - INTERVAL '7 days'
                ${instanceFilter}
            `, params),

            // Top 5 failing workflows (7d)
            query(`
                SELECT w.name as workflow_name, w.remote_id, i.name as instance_name, i.id as instance_id,
                       COUNT(*)::int as error_count
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                JOIN instances i ON w.instance_id = i.id
                WHERE e.status = 'error' AND e.started_at >= NOW() - INTERVAL '7 days'
                ${instanceFilter}
                GROUP BY w.id, w.name, w.remote_id, i.name, i.id
                ORDER BY error_count DESC
                LIMIT 5
            `, params),

            // Top 5 failing nodes (7d)
            query(`
                SELECT e.error_node, COUNT(*)::int as error_count
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                JOIN instances i ON w.instance_id = i.id
                WHERE e.status = 'error' AND e.error_node IS NOT NULL 
                  AND e.started_at >= NOW() - INTERVAL '7 days'
                ${instanceFilter}
                GROUP BY e.error_node
                ORDER BY error_count DESC
                LIMIT 5
            `, params),

            // Diagnosis stats
            query(`
                SELECT 
                    COUNT(*) FILTER (WHERE e.ai_diagnosis IS NOT NULL)::int as diagnosed,
                    COUNT(*) FILTER (WHERE e.ai_diagnosis IS NOT NULL AND e.started_at >= NOW() - INTERVAL '24 hours')::int as diagnosed_24h,
                    (SELECT COUNT(*)::int FROM diagnosis_feedback WHERE rating = 'up') as thumbs_up,
                    (SELECT COUNT(*)::int FROM diagnosis_feedback WHERE rating = 'down') as thumbs_down
                FROM executions e
                JOIN workflows w ON e.workflow_id = w.id
                JOIN instances i ON w.instance_id = i.id
                WHERE e.status = 'error'
                ${instanceFilter}
            `, params),
        ]);

        // Error rate (errors / total executions) for 24h
        const totalExecs24h = await query(`
            SELECT COUNT(*)::int as count
            FROM executions e
            JOIN workflows w ON e.workflow_id = w.id
            JOIN instances i ON w.instance_id = i.id
            WHERE e.started_at >= NOW() - INTERVAL '24 hours'
            ${instanceFilter}
        `, params);

        const errorCount24h = errors24h.rows[0]?.count || 0;
        const totalCount24h = totalExecs24h.rows[0]?.count || 0;
        const errorRate24h = totalCount24h > 0 ? ((errorCount24h / totalCount24h) * 100).toFixed(1) : '0.0';

        res.json({
            errors_24h: errorCount24h,
            errors_7d: errors7d.rows[0]?.count || 0,
            unique_failing_workflows_24h: errors24h.rows[0]?.unique_workflows || 0,
            error_rate_24h: parseFloat(errorRate24h),
            total_executions_24h: totalCount24h,
            top_failing_workflows: topWorkflows.rows,
            top_failing_nodes: topNodes.rows,
            diagnosis_stats: diagnosisStats.rows[0] || { diagnosed: 0, diagnosed_24h: 0, thumbs_up: 0, thumbs_down: 0 },
        });
    } catch (error) {
        console.error('Error fetching error stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/errors/:id - Get single error detail with AI fix history
router.get('/:id', validateUUID('id'), async (req: Request, res: Response) => {
    try {
        const errorResult = await query(`
            SELECT 
                e.id,
                e.remote_execution_id,
                e.status,
                e.started_at,
                e.finished_at,
                e.duration_ms,
                e.error_message,
                e.error_node,
                e.ai_diagnosis,
                w.name as workflow_name,
                w.remote_id as workflow_remote_id,
                w.node_count,
                i.id as instance_id,
                i.name as instance_name,
                i.base_url,
                i.n8n_api_key_encrypted IS NOT NULL as has_api_key
            FROM executions e
            JOIN workflows w ON e.workflow_id = w.id
            JOIN instances i ON w.instance_id = i.id
            WHERE e.id = $1
        `, [req.params.id]);

        if (errorResult.rows.length === 0) {
            return res.status(404).json({ error: 'Execution not found' });
        }

        // Get AI fix attempts for this execution
        const fixAttempts = await query(`
            SELECT id, status, ai_diagnosis, ai_fix_description, fix_applied, triggered_by, created_at, completed_at
            FROM ai_fix_attempts
            WHERE execution_id = $1
            ORDER BY created_at DESC
        `, [req.params.id]);

        res.json({
            error: errorResult.rows[0],
            fix_attempts: fixAttempts.rows,
        });
    } catch (error) {
        console.error('Error fetching error detail:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/errors/:id/diagnose - Trigger AI diagnosis for an error
// Body: { mode: 'simple' | 'complex', force?: boolean } — default mode 'simple'
router.post('/:id/diagnose', validateUUID('id'), diagnosisLimiter, async (req: Request, res: Response) => {
    try {
        const executionId = req.params.id as string;
        const mode = req.body?.mode === 'complex' ? 'complex' : 'simple';
        const force = !!req.body?.force;
        const result = mode === 'complex'
            ? await complexDiagnoseError(executionId, force)
            : await diagnoseError(executionId, force);
        res.json(result);
    } catch (error: any) {
        console.error('AI diagnosis error:', error);
        res.status(400).json({ error: error.message || 'Diagnosis failed' });
    }
});

// POST /api/errors/:id/diagnosis-feedback - Submit feedback on a diagnosis
// Body: { rating: 'up' | 'down', comment?: string, mode?: string }
router.post('/:id/diagnosis-feedback', validateUUID('id'), async (req: Request, res: Response) => {
    try {
        const executionId = req.params.id as string;
        const { rating, comment, mode } = req.body || {};

        if (!rating || !['up', 'down'].includes(rating)) {
            return res.status(400).json({ error: 'rating must be "up" or "down"' });
        }

        // Snapshot current diagnosis
        const execResult = await query(
            `SELECT ai_diagnosis FROM executions WHERE id = $1`,
            [executionId]
        );
        const snapshot = execResult.rows[0]?.ai_diagnosis || null;

        await query(
            `INSERT INTO diagnosis_feedback (execution_id, rating, comment, diagnosis_mode, diagnosis_snapshot)
             VALUES ($1, $2, $3, $4, $5)`,
            [executionId, rating, comment || null, mode || null, snapshot ? JSON.stringify(snapshot) : null]
        );

        res.json({ ok: true });
    } catch (error: any) {
        console.error('Diagnosis feedback error:', error);
        res.status(400).json({ error: error.message || 'Failed to save feedback' });
    }
});

// POST /api/errors/:id/enrich - Fetch missing error details from n8n
router.post('/:id/enrich', validateUUID('id'), async (req: Request, res: Response) => {
    try {
        const executionId = req.params.id as string;
        const result = await enrichErrorDetails(executionId);
        res.json(result);
    } catch (error: any) {
        console.error('Error enrichment error:', error);
        res.status(400).json({ error: error.message || 'Enrichment failed' });
    }
});

// POST /api/errors/:id/fix - Trigger AI fix for an error
router.post('/:id/fix', validateUUID('id'), diagnosisLimiter, async (req: Request, res: Response) => {
    try {
        const executionId = req.params.id as string;
        const result = await attemptAiFix(executionId, 'manual');
        res.json(result);
    } catch (error: any) {
        console.error('AI fix error:', error);
        res.status(400).json({ error: error.message || 'AI fix failed' });
    }
});

export default router;
