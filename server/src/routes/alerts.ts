import { Router } from 'express';
import { getActiveAlerts, resolveAlert } from '../services/alerts';

const router = Router();

router.get('/', async (req, res) => {
    try {
        const alerts = await getActiveAlerts();
        res.json({ alerts });
    } catch (error) {
        console.error('Error fetching alerts:', error);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

router.post('/:id/acknowledge', async (req, res) => {
    try {
        await resolveAlert(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error resolving alert:', error);
        res.status(500).json({ error: 'Failed to resolve alert' });
    }
});

export default router;
