import { Router, Request, Response } from 'express';
import { query } from '../db';
import { LATEST_REPORTER_VERSION, createAlert, AlertType } from '../services/alerts';
import { encrypt, decrypt } from '../services/encryption';
import { safeFetch, SSRFError } from '../lib/safe-fetch';
import { generateIngestToken } from '../lib/tokens';
import crypto from 'crypto';

async function getAccountIngestToken(): Promise<string> {
    const result = await query("SELECT value FROM settings WHERE key = 'account_ingest_token'");
    if (result.rows.length === 0 || !result.rows[0].value) {
        // Auto-generate if missing (first boot race condition)
        const token = generateIngestToken(16);
        await query(
            "INSERT INTO settings (key, value, is_encrypted) VALUES ('account_ingest_token', $1, false) ON CONFLICT (key) DO NOTHING",
            [token]
        );
        return token;
    }
    return result.rows[0].value;
}

function buildWebhookUrl(req: Request, accountToken: string, instanceToken: string): string {
    const publicUrl = process.env.SENTINEL_PUBLIC_URL || `${req.protocol}://${req.get('host') as string}`;
    return `${publicUrl.replace(/\/+$/, '')}/${accountToken}/${instanceToken}/ingest`;
}

function isValidHttpUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

const router = Router();

// GET /api/instances - List all instances with counts
router.get('/', async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT i.id, i.name, i.environment, i.n8n_version, i.base_url, i.is_active, i.last_heartbeat, i.reporter_version,
                (SELECT COUNT(*) FROM workflows w WHERE w.instance_id = i.id)::int AS workflow_count,
                (SELECT COUNT(*) FROM workflows w WHERE w.instance_id = i.id AND w.is_active = true)::int AS active_workflow_count,
                (SELECT COUNT(*) FROM executions e JOIN workflows w ON e.workflow_id = w.id WHERE w.instance_id = i.id AND e.started_at > NOW() - INTERVAL '24 hours')::int AS executions_24h,
                (SELECT COUNT(*) FROM executions e JOIN workflows w ON e.workflow_id = w.id WHERE w.instance_id = i.id AND e.started_at > NOW() - INTERVAL '24 hours' AND e.status = 'error')::int AS errors_24h
            FROM instances i
            ORDER BY i.created_at DESC
        `);
        res.json({ instances: result.rows });
    } catch (error) {
        console.error('Error fetching instances:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/instances/verify-n8n - Verify a URL is an n8n instance and optionally fetch baseline counts
router.post('/verify-n8n', async (req: Request, res: Response) => {
    const { url, api_key } = req.body;
    if (!url) { res.status(400).json({ error: 'URL is required' }); return; }

    // Validate URL format
    const baseUrl = url.replace(/\/+$/, '');
    try {
        const parsed = new URL(baseUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            res.status(400).json({ error: 'URL must start with http:// or https://' });
            return;
        }
    } catch {
        res.status(400).json({ error: 'Invalid URL format. Example: https://n8n.example.com' });
        return;
    }

    // Step 1: Multi-strategy verification
    let isN8n = false;
    let verifyMethod: 'healthz' | 'html' | null = null;
    let reachable = false;
    let httpStatus: number | null = null;
    let diagInfo = '';

    // Strategy A: Try /healthz (fastest, most reliable)
    try {
        const healthRes = await safeFetch(`${baseUrl}/healthz`, {}, { timeoutMs: 8000, allowHttp: true });
        reachable = true;
        httpStatus = healthRes.status;
        if (healthRes.ok) {
            const body = await healthRes.json().catch(() => ({}));
            if (body.status === 'ok') {
                isN8n = true;
                verifyMethod = 'healthz';
            }
        }
    } catch (e: any) {
        if (e instanceof SSRFError) {
            res.status(422).json({
                error: 'URL blocked for security reasons',
                details: e.message,
                suggestions: ['Only public URLs are allowed. Private/internal network addresses are blocked.']
            });
            return;
        }
        diagInfo = e.code || e.message || 'Unknown error';
    }

    // Strategy B: Fetch the root HTML page and look for n8n indicators
    if (!isN8n) {
        try {
            const htmlRes = await safeFetch(baseUrl, {
                headers: { 'Accept': 'text/html,application/xhtml+xml,*/*', 'User-Agent': 'Sentinel/1.0' },
            }, { timeoutMs: 10000, allowHttp: true });
            reachable = true;
            httpStatus = htmlRes.status;

            if (htmlRes.ok) {
                const html = await htmlRes.text();
                // n8n's UI page contains identifiable markers
                const n8nIndicators = [
                    /n8n/i,                             // "n8n" anywhere in page
                    /window\.n8n/i,                     // n8n JS bootstrap
                    /<title>.*n8n.*<\/title>/i,         // page title
                    /n8n-design-system/i,               // n8n component library
                    /\/rest\/settings/i,                 // n8n REST API call in JS
                    /n8n\.cloud/i,                      // n8n cloud reference
                ];
                const matchCount = n8nIndicators.filter(rx => rx.test(html)).length;
                if (matchCount >= 2) {
                    isN8n = true;
                    verifyMethod = 'html';
                } else if (matchCount === 1) {
                    // Weak signal — might be n8n behind a proxy that modifies the page
                    isN8n = true;
                    verifyMethod = 'html';
                }

                // Detect Cloudflare challenge page
                if (!isN8n && (
                    /cf-browser-verification/i.test(html) ||
                    /Checking your browser/i.test(html) ||
                    /challenges\.cloudflare\.com/i.test(html) ||
                    /cf-chl-/i.test(html)
                )) {
                    res.status(422).json({
                        error: 'Cloudflare bot protection detected',
                        details: 'Your n8n instance is behind Cloudflare with Bot Fight Mode or Under Attack Mode enabled. Sentinel cannot verify the URL through Cloudflare\'s challenge page.',
                        suggestions: [
                            'Whitelist the Sentinel server IP in Cloudflare WAF rules',
                            'Add a Cloudflare page rule to bypass security for /healthz',
                            'Temporarily disable Bot Fight Mode during onboarding',
                            'Use a Cloudflare Access tunnel with service tokens instead',
                        ]
                    });
                    return;
                }
            }
        } catch (e: any) {
            if (e instanceof SSRFError) {
                res.status(422).json({
                    error: 'URL blocked for security reasons',
                    details: e.message,
                    suggestions: ['Only public URLs are allowed. Private/internal network addresses are blocked.']
                });
                return;
            }
            if (!diagInfo) diagInfo = e.code || e.message || 'Unknown error';
        }
    }

    // If still not verified, return detailed diagnostics
    if (!isN8n) {
        if (!reachable) {
            // Could not connect at all
            const suggestions: string[] = [
                'Verify the URL is correct and includes the port if non-standard (e.g. https://n8n.example.com:5678)',
                'Ensure the n8n instance is running and accessible from this server',
            ];
            if (diagInfo.includes('ECONNREFUSED')) {
                suggestions.push('Connection refused — the host is reachable but nothing is listening on that port');
            } else if (diagInfo.includes('ENOTFOUND') || diagInfo.includes('getaddrinfo')) {
                suggestions.push('DNS resolution failed — check the domain name is correct');
            } else if (diagInfo.includes('ETIMEDOUT') || diagInfo.includes('abort')) {
                suggestions.push('Connection timed out — the host may be behind a firewall or VPN');
                suggestions.push('If n8n is on a private network, ensure the Sentinel server can reach it');
            } else if (diagInfo.includes('CERT') || diagInfo.includes('SSL') || diagInfo.includes('certificate')) {
                suggestions.push('SSL/TLS certificate error — the instance may have a self-signed or expired certificate');
                suggestions.push('Try using http:// instead of https:// if applicable');
            }
            res.status(422).json({
                error: `Could not connect to ${baseUrl}`,
                details: diagInfo,
                suggestions
            });
            return;
        }

        // Reachable but not recognized as n8n
        const suggestions: string[] = [
            'Confirm the URL points directly to your n8n instance (not a reverse proxy landing page)',
            'If behind a reverse proxy, ensure /healthz is forwarded to n8n',
        ];
        if (httpStatus === 401 || httpStatus === 403) {
            suggestions.unshift('The server returned 403/401 — it may require authentication to access');
            suggestions.push('If using basic auth or SSO in front of n8n, provide the full authenticated URL');
        } else if (httpStatus === 502 || httpStatus === 503) {
            suggestions.push('The server returned 502/503 — n8n may be starting up or the reverse proxy cannot reach the backend');
        } else if (httpStatus === 520 || httpStatus === 521 || httpStatus === 522 || httpStatus === 523 || httpStatus === 524) {
            suggestions.push(`Cloudflare error ${httpStatus} detected — Cloudflare cannot reach your origin server`);
            suggestions.push('Check your Cloudflare DNS and origin server settings');
        }
        suggestions.push('Cloudflare Bot Fight Mode or Under Attack Mode can block automated requests');
        suggestions.push('Firewall or VPN restrictions may prevent server-to-server connections');

        res.status(422).json({
            error: 'URL is reachable but could not be verified as an n8n instance',
            details: `HTTP ${httpStatus || 'unknown'} — neither /healthz nor the root page contained n8n indicators`,
            suggestions
        });
        return;
    }

    // Step 2: If API key provided, verify it works and fetch counts
    let workflowCount: number | null = null;
    let executionCount: number | null = null;

    if (api_key) {
        const headers: Record<string, string> = { 'X-N8N-API-KEY': api_key, 'Accept': 'application/json' };

        // Paginate through all workflows for exact count (one-time onboarding cost)
        try {
            let total = 0;
            let cursor: string | null = null;
            const MAX_PAGES = 20; // safety cap: 20 × 250 = 5000 workflows max

            for (let page = 0; page < MAX_PAGES; page++) {
                const qs: string = cursor ? `?limit=250&cursor=${cursor}` : '?limit=250';
                const wfRes = await safeFetch(`${baseUrl}/api/v1/workflows${qs}`, {
                    headers,
                }, { timeoutMs: 10000, allowHttp: true });

                if (wfRes.status === 401 || wfRes.status === 403) {
                    res.status(422).json({ error: 'API key is invalid or lacks permission. Check your n8n API key.' });
                    return;
                }
                if (!wfRes.ok) break;

                const body: any = await wfRes.json();
                total += body.data?.length ?? 0;
                cursor = body.nextCursor ?? null;
                if (!cursor) break;
            }
            workflowCount = total;
        } catch (e) {
            // Non-fatal — we still verified the URL
        }

        // Get execution count: fetch one page to confirm API key works, use count as baseline
        // Exact total isn't feasible (could be millions), so we report the recent batch size
        try {
            const exRes = await safeFetch(`${baseUrl}/api/v1/executions?limit=250`, {
                headers,
            }, { timeoutMs: 8000, allowHttp: true });
            if (exRes.ok) {
                const exBody = await exRes.json();
                const count = exBody.data?.length ?? 0;
                // If there's a nextCursor, there are more than 250
                executionCount = exBody.nextCursor ? null : count;
            }
        } catch (e) {
            // Non-fatal
        }
    }

    res.json({
        verified: true,
        url: baseUrl,
        verify_method: verifyMethod,
        workflow_count: workflowCount,
        execution_count: executionCount,
    });
});

// POST /api/instances - Register new instance
router.post('/', async (req: Request, res: Response) => {
    const { name, environment, base_url, baseline_workflow_count, baseline_execution_count } = req.body;

    if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
    }

    if (base_url && !isValidHttpUrl(base_url)) {
        res.status(400).json({ error: 'base_url must be a valid http:// or https:// URL' });
        return;
    }

    try {
        // Check for duplicate base_url (if provided)
        if (base_url) {
            const urlCheck = await query(
                `SELECT id, name FROM instances WHERE base_url = $1`,
                [base_url]
            );
            if (urlCheck.rows.length > 0) {
                res.status(409).json({
                    error: `An instance with this URL already exists: "${urlCheck.rows[0].name}"`,
                    existing_id: urlCheck.rows[0].id,
                });
                return;
            }
        }

        // Check for duplicate name
        const nameCheck = await query(
            `SELECT id FROM instances WHERE LOWER(name) = LOWER($1)`,
            [name]
        );
        if (nameCheck.rows.length > 0) {
            res.status(409).json({ error: `An instance named "${name}" already exists` });
            return;
        }

        // Generate HMAC secret and ingest token
        const hmacSecret = crypto.randomBytes(32).toString('base64');
        const ingestToken = generateIngestToken(24);

        const result = await query(
            `INSERT INTO instances (name, environment, base_url, hmac_secret, ingest_token, baseline_workflow_count, baseline_execution_count) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, name, hmac_secret, ingest_token, base_url`,
            [name, environment, base_url || null, hmacSecret, ingestToken, baseline_workflow_count || null, baseline_execution_count || null]
        );

        const newInstance = result.rows[0];
        const accountToken = await getAccountIngestToken();

        // Return secret only once
        res.status(201).json({
            id: newInstance.id,
            name: newInstance.name,
            hmac_secret: newInstance.hmac_secret,
            base_url: newInstance.base_url,
            webhook_url: buildWebhookUrl(req, accountToken, newInstance.ingest_token)
        });
    } catch (error) {
        console.error('Error registering instance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// GET /api/instances/:id - Instance details
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query(
            `SELECT id, name, environment, n8n_version, database_type, execution_mode, timezone, 
                    base_url, is_active, last_heartbeat, reporter_version,
                    baseline_workflow_count, baseline_execution_count, created_at,
                    n8n_api_key_encrypted IS NOT NULL as has_n8n_api_key
             FROM instances WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Instance not found' });
            return;
        }

        // Get expanded stats
        const stats = await query(
            `SELECT 
                (SELECT count(*)::int FROM workflows WHERE instance_id = $1) as total_workflows,
                (SELECT count(*)::int FROM workflows WHERE instance_id = $1 AND is_active = true) as active_workflows,
                (SELECT count(*)::int FROM executions e JOIN workflows w ON e.workflow_id = w.id WHERE w.instance_id = $1 AND e.started_at > NOW() - INTERVAL '24 hours') as executions_24h,
                (SELECT count(*)::int FROM executions e JOIN workflows w ON e.workflow_id = w.id WHERE w.instance_id = $1 AND e.started_at > NOW() - INTERVAL '7 days') as executions_7d,
                (SELECT count(*)::int FROM executions e JOIN workflows w ON e.workflow_id = w.id WHERE w.instance_id = $1 AND e.started_at > NOW() - INTERVAL '30 days') as executions_30d,
                (SELECT count(*)::int FROM executions e JOIN workflows w ON e.workflow_id = w.id WHERE w.instance_id = $1 AND e.status = 'error' AND e.started_at > NOW() - INTERVAL '24 hours') as errors_24h,
                (SELECT count(*)::int FROM executions e JOIN workflows w ON e.workflow_id = w.id WHERE w.instance_id = $1 AND e.status = 'error' AND e.started_at > NOW() - INTERVAL '7 days') as errors_7d,
                (SELECT COALESCE(SUM(t.tokens_input + t.tokens_output), 0)::bigint FROM token_usage t JOIN executions e ON t.execution_id = e.id JOIN workflows w ON e.workflow_id = w.id WHERE w.instance_id = $1 AND t.recorded_at > NOW() - INTERVAL '24 hours') as tokens_24h,
                (SELECT COALESCE(SUM(t.tokens_input + t.tokens_output), 0)::bigint FROM token_usage t JOIN executions e ON t.execution_id = e.id JOIN workflows w ON e.workflow_id = w.id WHERE w.instance_id = $1 AND t.recorded_at > NOW() - INTERVAL '7 days') as tokens_7d`,
            [id]
        );

        res.json({
            instance: result.rows[0],
            stats: stats.rows[0],
            latest_reporter_version: LATEST_REPORTER_VERSION
        });
    } catch (error) {
        console.error('Error fetching instance details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/instances/:id - Update instance (name, environment, base_url)
router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, environment, base_url } = req.body;
        if (base_url !== undefined && base_url !== null && base_url !== '' && !isValidHttpUrl(base_url)) {
            res.status(400).json({ error: 'base_url must be a valid http:// or https:// URL' });
            return;
        }
        const sets: string[] = [];
        const vals: any[] = [];
        let idx = 1;
        if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
        if (environment !== undefined) { sets.push(`environment = $${idx++}`); vals.push(environment); }
        if (base_url !== undefined) { sets.push(`base_url = $${idx++}`); vals.push(base_url || null); }
        if (sets.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
        vals.push(id);
        const result = await query(
            `UPDATE instances SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, name, environment, base_url`,
            vals
        );
        if (result.rows.length === 0) { res.status(404).json({ error: 'Instance not found' }); return; }
        res.json({ instance: result.rows[0] });
    } catch (error) {
        console.error('Error updating instance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/instances/:id - Delete instance and all related data
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query('DELETE FROM instances WHERE id = $1 RETURNING id, name', [id]);
        if (result.rows.length === 0) { res.status(404).json({ error: 'Instance not found' }); return; }
        res.json({ deleted: true, name: result.rows[0].name });
    } catch (error) {
        console.error('Error deleting instance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/instances/:id/toggle - Enable/disable instance
router.patch('/:id/toggle', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query(
            'UPDATE instances SET is_active = NOT is_active WHERE id = $1 RETURNING id, name, is_active',
            [id]
        );
        if (result.rows.length === 0) { res.status(404).json({ error: 'Instance not found' }); return; }
        res.json({ instance: result.rows[0] });
    } catch (error) {
        console.error('Error toggling instance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/instances/:id/rotate-secret - Rotate HMAC secret with 24h grace period
router.post('/:id/rotate-secret', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        // Move current secret to previous, generate new one
        const newSecret = crypto.randomBytes(32).toString('base64');
        const result = await query(
            `UPDATE instances 
             SET hmac_secret_previous = hmac_secret, 
                 hmac_secret = $1, 
                 hmac_secret_rotated_at = NOW() 
             WHERE id = $2 
             RETURNING id, name, hmac_secret`,
            [newSecret, id]
        );
        if (result.rows.length === 0) { res.status(404).json({ error: 'Instance not found' }); return; }
        res.json({
            instance: result.rows[0],
            message: 'Secret rotated. The previous secret will remain valid for 24 hours.',
        });
    } catch (error) {
        console.error('Error rotating secret:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/instances/:id/rotate-ingest-token - Rotate the per-instance ingest URL token
router.post('/:id/rotate-ingest-token', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const newToken = generateIngestToken(24);
        const result = await query(
            'UPDATE instances SET ingest_token = $1 WHERE id = $2 RETURNING id, name, ingest_token',
            [newToken, id]
        );
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Instance not found' });
            return;
        }

        // Create alert: "Update your reporter workflow"
        await createAlert(
            AlertType.INGEST_TOKEN_ROTATED,
            `Ingest token rotated for "${result.rows[0].name}". Update the reporter workflow with the new webhook URL.`,
            id as string,
            'warning'
        );

        const accountToken = await getAccountIngestToken();
        const webhookUrl = buildWebhookUrl(req, accountToken, newToken);

        res.json({
            instance: result.rows[0],
            webhook_url: webhookUrl,
            message: 'Ingest token rotated. Update your reporter workflow with the new webhook URL.',
        });
    } catch (error) {
        console.error('Error rotating ingest token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/instances/:id/webhook-url - Get the current webhook URL for an instance
router.get('/:id/webhook-url', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query('SELECT ingest_token FROM instances WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Instance not found' });
            return;
        }
        const accountToken = await getAccountIngestToken();
        const webhookUrl = buildWebhookUrl(req, accountToken, result.rows[0].ingest_token);
        res.json({ webhook_url: webhookUrl });
    } catch (error) {
        console.error('Error getting webhook URL:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/instances/:id/download-credentials - Get credentials needed for workflow download
router.get('/:id/download-credentials', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query(
            `SELECT hmac_secret, base_url, ingest_token FROM instances WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Instance not found' });
            return;
        }

        const accountToken = await getAccountIngestToken();
        const webhookUrl = buildWebhookUrl(req, accountToken, result.rows[0].ingest_token);

        res.json({
            hmac_secret: result.rows[0].hmac_secret,
            base_url: result.rows[0].base_url,
            webhook_url: webhookUrl
        });
    } catch (error) {
        console.error('Error fetching download credentials:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/instances/:id/api-key - Save or clear the n8n API key for this instance
router.put('/:id/api-key', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { api_key } = req.body;

        if (api_key) {
            // Trim whitespace, then encrypt and verify round-trip
            const trimmed = api_key.trim();
            if (!trimmed) {
                return res.status(400).json({ error: 'API key cannot be empty' });
            }
            const encrypted = encrypt(trimmed);
            // Verify round-trip to catch encryption bugs
            const roundTrip = decrypt(encrypted);
            if (roundTrip !== trimmed) {
                console.error('[api-key] Round-trip verification failed! Input length:', trimmed.length, 'Output length:', roundTrip.length);
                return res.status(500).json({ error: 'Encryption round-trip verification failed' });
            }
            await query('UPDATE instances SET n8n_api_key_encrypted = $1 WHERE id = $2', [encrypted, id]);
            console.log(`[api-key] Saved encrypted API key for instance ${id} (${trimmed.length} chars)`);
            res.json({ saved: true, message: 'n8n API key saved (encrypted)' });
        } else {
            // Clear the key
            await query('UPDATE instances SET n8n_api_key_encrypted = NULL WHERE id = $1', [id]);
            res.json({ saved: true, message: 'n8n API key cleared' });
        }
    } catch (error) {
        console.error('Error saving n8n API key:', error);
        res.status(500).json({ error: 'Failed to save API key' });
    }
});

// GET /api/instances/:id/workflows - List workflows for instance
router.get('/:id/workflows', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query(
            `SELECT w.*, 
        (SELECT json_agg(json_build_object('type', wr.resource_type, 'identifier', wr.resource_identifier, 'credential_name', wr.credential_name, 'node_name', wr.node_name)) 
         FROM workflow_resources wr WHERE wr.workflow_id = w.id) as resources
       FROM workflows w 
       WHERE w.instance_id = $1 
       ORDER BY w.name ASC`,
            [id]
        );
        res.json({ workflows: result.rows });
    } catch (error) {
        console.error('Error fetching instance workflows:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/instances/:id/resources - List resources for instance grouped by type
router.get('/:id/resources', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query(
            `SELECT wr.resource_type, wr.resource_identifier, wr.provider, wr.credential_name, wr.node_name,
                    w.name as workflow_name, w.id as workflow_id,
                    wr.first_seen_at, wr.last_seen_at
             FROM workflow_resources wr
             JOIN workflows w ON wr.workflow_id = w.id
             WHERE w.instance_id = $1
             ORDER BY wr.resource_type, wr.resource_identifier, w.name`,
            [id]
        );
        // Group by type → identifier
        const grouped: Record<string, any[]> = {};
        for (const row of result.rows) {
            const key = row.resource_type;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(row);
        }
        res.json({ resources: grouped, total: result.rows.length });
    } catch (error) {
        console.error('Error fetching instance resources:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/instances/:id/executions - List executions for instance (with filters)
router.get('/:id/executions', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const { workflow_id, status, date_from, date_to } = req.query;

        const conditions = ['w.instance_id = $1'];
        const vals: any[] = [id];
        let idx = 2;

        if (workflow_id) { conditions.push(`e.workflow_id = $${idx++}`); vals.push(workflow_id); }
        if (status) { conditions.push(`e.status = $${idx++}`); vals.push(status); }
        if (date_from) { conditions.push(`e.started_at >= $${idx++}`); vals.push(date_from); }
        if (date_to) { conditions.push(`e.started_at <= $${idx++}`); vals.push(date_to); }

        vals.push(limit);
        const result = await query(
            `SELECT e.*, w.name as workflow_name
             FROM executions e
             JOIN workflows w ON e.workflow_id = w.id
             WHERE ${conditions.join(' AND ')}
             ORDER BY e.started_at DESC
             LIMIT $${idx}`,
            vals
        );
        res.json({ executions: result.rows });
    } catch (error) {
        console.error('Error fetching instance executions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
