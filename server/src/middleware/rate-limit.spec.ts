import express from 'express';
import request from 'supertest';
import { refreshLimiter, logoutLimiter } from './rate-limit';

function buildApp(limiter: express.RequestHandler, path: string) {
    const app = express();
    app.use(express.json());
    app.post(path, limiter, (_req, res) => { res.json({ ok: true }); });
    return app;
}

describe('refreshLimiter', () => {
    it('allows up to the threshold and rejects after', async () => {
        const app = buildApp(refreshLimiter, '/api/auth/refresh');
        for (let i = 0; i < 5; i++) {
            const res = await request(app).post('/api/auth/refresh').send({});
            expect(res.status).toBe(200);
        }
        const over = await request(app).post('/api/auth/refresh').send({});
        expect(over.status).toBe(429);
    });
});

describe('logoutLimiter', () => {
    it('rejects after threshold', async () => {
        const app = buildApp(logoutLimiter, '/api/auth/logout');
        for (let i = 0; i < 10; i++) await request(app).post('/api/auth/logout').send({});
        const over = await request(app).post('/api/auth/logout').send({});
        expect(over.status).toBe(429);
    });
});
