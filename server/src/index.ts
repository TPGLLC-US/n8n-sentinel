import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { checkDatabaseHealth } from './db';
import { getSessionSecret, seedAdminUser } from './lib/auth';
import { loginLimiter, refreshLimiter, logoutLimiter } from './middleware/rate-limit';

dotenv.config(); // try CWD/.env
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') }); // fallback: monorepo root

// ─── Startup validation ─────────────────────────────────────────────────
// getSessionSecret() exits the process if SESSION_SECRET is missing or default
const SESSION_SECRET = getSessionSecret();

const app: Express = express();
const port = process.env.PORT || 3000;

// ─── Security middleware ────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https://models.dev"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
        },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
}));

const corsOrigin = process.env.CORS_ORIGIN || (
    process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173'
);
app.use(cors({
    origin: corsOrigin as string | false,
    credentials: true,
}));

app.use(express.json({ limit: '50mb' }));

app.get('/health', async (req: Request, res: Response) => {
    const dbConnected = await checkDatabaseHealth();

    if (dbConnected) {
        res.json({
            status: 'healthy',
            version: '1.0.0',
            checks: {
                database: 'connected',
                uptime_seconds: process.uptime()
            }
        });
    } else {
        res.status(503).json({
            status: 'unhealthy',
            checks: {
                database: 'disconnected'
            }
        });
    }
});

import instancesRouter from './routes/instances';
import ingestRouter from './routes/ingest';
import metricsRouter from './routes/metrics';
import resourcesRouter from './routes/resources';
import executionsRouter from './routes/executions';
import alertsRouter from './routes/alerts';
import modelsRouter from './routes/models';
import settingsRouter from './routes/settings';
import errorsRouter from './routes/errors';
import reportsRouter from './routes/reports';
import { login, requireAuth, refresh, logoutHandler } from './middleware/session';
import { validateIngestPath } from './middleware/auth';
import { ensureModelsLoaded } from './services/models';
import { startReportScheduler } from './services/report-scheduler';
import { startDataRetention } from './services/data-retention';
import { startScheduler, stopScheduler } from './services/scheduler';

app.post('/api/login', loginLimiter, login);
app.post('/api/auth/refresh', refreshLimiter, refresh);
app.post('/api/auth/logout', logoutLimiter, logoutHandler);

// Public Routes — Per-instance ingest paths (preferred)
app.use('/:accountToken/:instanceToken/ingest', validateIngestPath, ingestRouter);

// Legacy ingest path (deprecated, backwards compatible)
app.use('/api/ingest', (req, res, next) => {
    console.warn('[ingest] DEPRECATED: /api/ingest path used. Migrate to per-instance URLs.');
    next();
}, ingestRouter);

// Protected Routes
app.use('/api/instances', requireAuth, instancesRouter);
app.use('/api/metrics', requireAuth, metricsRouter);
app.use('/api/resources', requireAuth, resourcesRouter);
app.use('/api/executions', requireAuth, executionsRouter);
app.use('/api/alerts', requireAuth, alertsRouter);
app.use('/api/models', requireAuth, modelsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/errors', requireAuth, errorsRouter);
app.use('/api/reports', requireAuth, reportsRouter);

// API routes — static files in production, dev message otherwise
app.get('/', (req: Request, res: Response) => {
    if (process.env.NODE_ENV === 'production') {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    } else {
        res.send('n8n Sentinel API (Dev Mode)');
    }
});

if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../public')));

    // Handle React routing, return all requests to React app
    app.get('/{*path}', (req: Request, res: Response) => {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    });
}

async function boot(): Promise<void> {
    try { await seedAdminUser(); } catch (err) { console.error('[boot] seedAdminUser failed:', err); process.exit(1); }
    try { await ensureModelsLoaded(); } catch (err) { console.error('[boot] ensureModelsLoaded failed:', err); }
    try { await startReportScheduler(); } catch (err) { console.error('[boot] startReportScheduler failed:', err); }
    try { startDataRetention(); } catch (err) { console.error('[boot] startDataRetention failed:', err); }
}

const server = app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
    startScheduler();
    boot();
});

function shutdown(signal: string): void {
    console.log(`[server] ${signal} received, shutting down`);
    stopScheduler();
    server.close(() => {
        console.log('[server] HTTP closed, exiting');
        process.exit(0);
    });
    // Force-exit after 10s if close hangs
    setTimeout(() => {
        console.error('[server] forced exit after timeout');
        process.exit(1);
    }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
