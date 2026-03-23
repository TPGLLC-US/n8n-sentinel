import { Router } from 'express';
import { query } from '../db';

const router = Router();

router.get('/', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 500;
        const result = await query(`
            SELECT e.*, w.name as workflow_name, i.name as instance_name 
            FROM executions e
            JOIN workflows w ON e.workflow_id = w.id
            JOIN instances i ON w.instance_id = i.id
            ORDER BY e.started_at DESC 
            LIMIT $1
        `, [limit]);
        res.json({ executions: result.rows });
    } catch (error) {
        console.error('Error fetching executions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
