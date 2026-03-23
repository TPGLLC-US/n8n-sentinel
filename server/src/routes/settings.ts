import { Router, Request, Response } from 'express';
import { query } from '../db';
import { encrypt, decrypt } from '../services/encryption';

const router = Router();

// Keys that contain sensitive data and must be encrypted at rest
const SENSITIVE_KEYS = ['anthropic_api_key', 'resend_api_key'];

// All allowed setting keys (whitelist)
const ALLOWED_KEYS = [
    'anthropic_api_key', 'auto_fix_enabled', 'max_fixes_per_day',
    'resend_api_key', 'report_from_email', 'report_recipients',
    'report_schedule', 'report_daily_hour', 'report_weekly_day', 'report_monthly_day',
    'report_instance_breakdown',
    'retention_executions_days', 'retention_alerts_days', 'retention_token_usage_days',
    'alert_email_enabled', 'alert_email_types',
];

// GET /api/settings - Get all settings (masks sensitive values)
router.get('/', async (req: Request, res: Response) => {
    try {
        const result = await query('SELECT key, value, is_encrypted, updated_at FROM settings');
        const settings: Record<string, any> = {};
        for (const row of result.rows) {
            if (row.is_encrypted) {
                // Return masked value so the client knows a key is set
                settings[row.key] = { is_set: !!row.value, updated_at: row.updated_at };
            } else {
                settings[row.key] = { value: row.value, updated_at: row.updated_at };
            }
        }
        res.json({ settings });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/settings - Update one or more settings
router.put('/', async (req: Request, res: Response) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Request body must be an object of key-value pairs' });
        }

        const results: Record<string, string> = {};
        for (const [key, rawValue] of Object.entries(updates)) {
            if (!ALLOWED_KEYS.includes(key)) {
                results[key] = 'rejected (unknown key)';
                continue;
            }

            const isSensitive = SENSITIVE_KEYS.includes(key);
            const value = rawValue as string;

            // Allow clearing a key by setting empty string or null
            const storeValue = (!value || value === '') ? null : (isSensitive ? encrypt(value) : value);

            await query(
                `INSERT INTO settings (key, value, is_encrypted, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (key) DO UPDATE SET value = $2, is_encrypted = $3, updated_at = NOW()`,
                [key, storeValue, isSensitive]
            );
            results[key] = 'saved';
        }

        res.json({ results });
    } catch (error: any) {
        if (error.message?.includes('ENCRYPTION_KEY')) {
            return res.status(500).json({ error: 'Server encryption key not configured. Set ENCRYPTION_KEY env var.' });
        }
        console.error('Error saving settings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Internal helper: get a decrypted setting value (used by other services)
export async function getSetting(key: string): Promise<string | null> {
    const result = await query('SELECT value, is_encrypted FROM settings WHERE key = $1', [key]);
    if (result.rows.length === 0 || !result.rows[0].value) return null;
    const row = result.rows[0];
    return row.is_encrypted ? decrypt(row.value) : row.value;
}

export default router;
