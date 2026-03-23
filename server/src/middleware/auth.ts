import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { query } from '../db';

// Extend Request to include instance info
declare global {
    namespace Express {
        interface Request {
            instance?: {
                id: string;
                name: string;
                hmac_secret: string;
                hmac_secret_previous?: string;
                hmac_secret_rotated_at?: string;
                ingest_token?: string;
                is_active?: boolean;
            };
            /** Set by validateIngestPath when instance was resolved via URL path tokens */
            instanceResolvedByPath?: boolean;
        }
    }
}

// ─── HMAC signature verification (shared logic) ──────────────────────────
function verifyHmacSignature(
    signature: string,
    payloadString: string,
    instance: { hmac_secret: string; hmac_secret_previous?: string; hmac_secret_rotated_at?: string; id: string }
): boolean {
    function verifyHmac(secret: string): boolean {
        const expected = crypto
            .createHmac('sha256', secret)
            .update(payloadString)
            .digest('base64');
        const source = Buffer.from(signature);
        const target = Buffer.from(expected);
        if (source.length !== target.length) return false;
        return crypto.timingSafeEqual(source, target);
    }

    let valid = verifyHmac(instance.hmac_secret);

    // Grace period: try previous secret if rotation was within 24 hours
    if (!valid && instance.hmac_secret_previous && instance.hmac_secret_rotated_at) {
        const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
        const rotatedAt = new Date(instance.hmac_secret_rotated_at).getTime();
        if (Date.now() - rotatedAt < GRACE_PERIOD_MS) {
            valid = verifyHmac(instance.hmac_secret_previous);
            if (valid) {
                console.log(`[auth] Instance ${instance.id} authenticated with previous secret (grace period)`);
            }
        }
    }

    return valid;
}

// ─── Path-based ingest authentication ─────────────────────────────────────
export const validateIngestPath = async (req: Request, res: Response, next: NextFunction) => {
    const { accountToken, instanceToken } = req.params;

    if (!accountToken || !instanceToken) {
        res.status(404).json({ error: 'Not found' });
        return;
    }

    try {
        // Verify account token
        const settingResult = await query(
            "SELECT value FROM settings WHERE key = 'account_ingest_token'",
            []
        );
        if (settingResult.rows.length === 0 || settingResult.rows[0].value !== accountToken) {
            res.status(404).json({ error: 'Not found' });
            return;
        }

        // Look up instance by ingest_token
        const result = await query(
            'SELECT id, name, hmac_secret, hmac_secret_previous, hmac_secret_rotated_at, is_active, ingest_token FROM instances WHERE ingest_token = $1',
            [instanceToken]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Not found' });
            return;
        }

        if (!result.rows[0].is_active) {
            res.status(403).json({ error: 'Instance disabled' });
            return;
        }

        // Set instance on request for downstream use
        req.instance = result.rows[0];
        req.instanceResolvedByPath = true;
        next();
    } catch (error) {
        console.error('Ingest path auth error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ─── Body-based HMAC signature validation (legacy + path-based) ───────────
export const validateSignature = async (req: Request, res: Response, next: NextFunction) => {
    const signature = req.headers['x-sentinel-signature'] as string;

    // If instance already resolved by path-based auth, skip DB lookup but still verify HMAC
    if (req.instanceResolvedByPath && req.instance) {
        if (!signature) {
            res.status(401).json({ error: 'Missing signature' });
            return;
        }
        const payloadString = JSON.stringify(req.body);
        if (!verifyHmacSignature(signature, payloadString, req.instance)) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }
        next();
        return;
    }

    // Legacy path: resolve instance from body
    const { instance_id } = req.body;

    if (!signature || !instance_id) {
        res.status(401).json({ error: 'Missing signature or instance_id' });
        return;
    }

    try {
        const result = await query(
            'SELECT id, name, hmac_secret, hmac_secret_previous, hmac_secret_rotated_at, is_active FROM instances WHERE id = $1',
            [instance_id]
        );

        if (result.rows.length === 0) {
            res.status(401).json({ error: 'Invalid instance' });
            return;
        }

        // PRD §5.2.5: Reject disabled instances with 403 Forbidden
        if (!result.rows[0].is_active) {
            res.status(403).json({ error: 'Instance disabled' });
            return;
        }

        const instance = result.rows[0];
        const payloadString = JSON.stringify(req.body);

        if (!verifyHmacSignature(signature, payloadString, instance)) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }

        req.instance = instance;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
