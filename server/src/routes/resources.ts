import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET /api/resources
router.get('/', async (req: Request, res: Response) => {
    try {
        const result = await query(
            `SELECT 
          wr.resource_type,
          wr.resource_identifier,
          wr.provider,
          MAX(wr.node_name) as node_name,
          MAX(wr.credential_name) as credential_name,
          MAX(wr.credential_id) as credential_id,
          BOOL_OR(wr.credential_exposed) as credential_exposed,
          count(DISTINCT wr.workflow_id) as workflow_count,
          json_agg(DISTINCT jsonb_build_object('name', w.name, 'remote_id', w.remote_id)) as workflows,
          MAX(wr.last_seen_at) as last_seen,
          i.id as instance_id,
          i.name as instance_name,
          i.base_url as instance_base_url
        FROM workflow_resources wr
        JOIN workflows w ON w.id = wr.workflow_id
        JOIN instances i ON i.id = w.instance_id
        GROUP BY wr.resource_type, wr.resource_identifier, wr.provider, i.id, i.name, i.base_url
        ORDER BY last_seen DESC`
        );

        res.json({ resources: result.rows });
    } catch (error) {
        console.error('Error fetching resources:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
