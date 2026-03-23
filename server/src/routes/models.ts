import { Router, Request, Response } from 'express';
import { ensureModelsLoaded, getProviders, getModelCount, lookupModel } from '../services/models';

const router = Router();

// GET /api/models/providers - List all providers with logos
router.get('/providers', async (req: Request, res: Response) => {
    try {
        await ensureModelsLoaded();
        const providers = getProviders();
        res.json({
            providers,
            totalModels: getModelCount(),
        });
    } catch (error) {
        console.error('Error fetching model providers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/models/lookup/:modelName - Look up a specific model
router.get('/lookup/:modelName', async (req: Request, res: Response) => {
    try {
        await ensureModelsLoaded();
        const modelName = req.params.modelName as string;
        const match = lookupModel(modelName);
        if (match) {
            res.json({ match });
        } else {
            res.status(404).json({ error: 'Model not found', query: modelName });
        }
    } catch (error) {
        console.error('Error looking up model:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
