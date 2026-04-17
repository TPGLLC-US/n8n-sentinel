import { query } from '../db';
import { getSetting } from '../routes/settings';
import { decrypt } from './encryption';
import { safeFetch } from '../lib/safe-fetch';
import { TIMEOUTS } from '../config/timeouts';
import { runAgentLoop, AgentTool } from './ai-agent';
import {
    extractNodesFromWorkflow,
    getConnectedNodes,
    getWorkflowMap,
    estimateTokens,
    extractNodeResultsFromExecution,
    replaceNodesInWorkflow,
    sanitizeWorkflowForAI,
    validateFixedNodes,
} from './workflow-utils';

export interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
}

export interface DiagnosisResult {
    diagnosis: string;
    cause: string;
    resolution: string;
    category: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    fixable: boolean;
    mode?: 'simple' | 'complex';
    token_usage?: TokenUsage;
}

interface FixResult {
    status: 'success' | 'failed' | 'rejected';
    diagnosis: string;
    fixDescription: string | null;
    fixApplied: boolean;
    token_usage?: TokenUsage;
}

// ─── n8n Knowledge Base (distilled from skills files) ──────────────────────
const N8N_KNOWLEDGE_BASE = `
## n8n Error Patterns Knowledge Base

### Error Categories & Frequency
- missing_required (45%): Required field not provided in node config. Check operation-dependent fields.
- invalid_value (28%): Wrong enum value, typo in operation name, invalid format (e.g. Slack channel without #).
- type_mismatch (12%): String instead of number, boolean as string "true" instead of true.
- invalid_expression (8%): Missing {{}}, wrong node reference, unsafe property access.
- invalid_reference (5%): Node renamed/deleted but still referenced in expressions.
- null/undefined access: "Cannot read property X of undefined" — missing null checks, optional chaining needed.

### Code Node Critical Rules
- MUST return [{json: {...}}] format — array of objects each with a json property.
- Missing return statement is #1 failure (38% of Code node errors).
- NEVER use n8n expression syntax {{}} inside Code nodes — use direct JavaScript ($json.field, not "{{$json.field}}").
- Use template literals with backticks for string interpolation: \`Hello \${$json.name}\`
- All code paths must return data (if/else branches).

### Expression Syntax Critical Rules
- Expressions MUST be wrapped in {{}} — plain $json.field is literal text.
- Webhook data is ALWAYS under .body: {{$json.body.email}} not {{$json.email}}.
- Node names with spaces need bracket notation: $node["HTTP Request"].json.data
- Node names are CASE-SENSITIVE — must match exactly.
- Array access uses brackets: $json.items[0].name, NOT $json.items.0.name
- The = prefix (="{{expr}}") is only for JSON mode fields.

### Node Configuration Patterns
- Operations have dependent properties — switching operation may require different fields.
- HTTP Request: sendBody=true requires body config; method determines required fields.
- Slack: channel must start with # and be lowercase.
- Enums are case-sensitive: "message" not "Message".

### What AI CAN Fix
- Null/undefined reference errors → add optional chaining ?.
- Expression syntax errors → fix brackets, node references, property paths
- Code node JavaScript bugs → fix return format, missing returns, syntax
- Data type mismatches → correct types
- Missing null checks → add guard clauses
- Missing required fields → add with sensible defaults

### What AI CANNOT Fix
- Expired credentials (OAuth tokens)
- API outages (external service down)
- Rate limiting (429 errors)
- Account/billing issues
- Network/connectivity problems
- Permission/authorization errors from external APIs
`;

// ─── Anthropic API helpers ─────────────────────────────────────────────────

function parseAiJsonResponse(text: string): any | null {
    // Try direct parse first
    try {
        return JSON.parse(text.trim());
    } catch { /* continue */ }

    // Strip markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
        try {
            return JSON.parse(fenceMatch[1].trim());
        } catch { /* continue */ }
    }

    // Find first { ... } block in the text
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
        try {
            return JSON.parse(text.slice(braceStart, braceEnd + 1));
        } catch { /* continue */ }
    }

    return null;
}

interface AnthropicResponse {
    text: string;
    token_usage: TokenUsage;
}

async function callAnthropicApi(apiKey: string, systemPrompt: string, userMessage: string, maxTokens: number = 4096, timeoutMs: number = 60000): Promise<AnthropicResponse> {
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        const preview = body.slice(0, 200).replace(/"(x-api-key|authorization)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"');
        throw new Error(`Anthropic API error (${res.status}): ${preview}`);
    }

    const data = await res.json();
    return {
        text: data.content?.[0]?.text || '',
        token_usage: {
            input_tokens: data.usage?.input_tokens ?? 0,
            output_tokens: data.usage?.output_tokens ?? 0,
        },
    };
}

// ─── Token usage logging ─────────────────────────────────────────────────

const AI_MODEL = 'claude-sonnet-4-20250514';

async function logTokenUsage(executionId: string, callType: 'diagnosis' | 'fix', usage: TokenUsage): Promise<void> {
    try {
        await query(
            `INSERT INTO token_usage (execution_id, model, provider, tokens_input, tokens_output, accuracy, source, call_type)
             VALUES ($1, $2, 'anthropic', $3, $4, 'exact', 'sentinel', $5)`,
            [executionId, AI_MODEL, usage.input_tokens, usage.output_tokens, callType]
        );
    } catch (err) {
        console.error('[ai-fix] Failed to log token usage:', err);
    }
}

// ─── n8n API helpers ──────────────────────────────────────────────────────

async function fetchWorkflowFromN8n(baseUrl: string, apiKey: string, workflowRemoteId: string): Promise<any> {
    const url = `${baseUrl}/api/v1/workflows/${workflowRemoteId}`;
    const res = await safeFetch(url, {
        headers: {
            'X-N8N-API-KEY': apiKey,
            'Accept': 'application/json',
        },
    }, { timeoutMs: TIMEOUTS.n8nApiRead, allowHttp: process.env.NODE_ENV !== 'production' });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to fetch workflow from n8n (${res.status}): ${body}`);
    }
    return res.json();
}

const N8N_WORKFLOW_PUT_FIELDS = ['name', 'nodes', 'connections', 'settings', 'staticData'] as const;

async function applyFixToN8n(baseUrl: string, apiKey: string, workflowRemoteId: string, fullWorkflowJson: any): Promise<void> {
    const url = `${baseUrl}/api/v1/workflows/${workflowRemoteId}`;
    // n8n public API uses PUT (full replacement) — only send accepted fields (allowlist)
    const payload: Record<string, any> = {};
    for (const key of N8N_WORKFLOW_PUT_FIELDS) {
        if (key in fullWorkflowJson) {
            payload[key] = fullWorkflowJson[key];
        }
    }
    const res = await safeFetch(url, {
        method: 'PUT',
        headers: {
            'X-N8N-API-KEY': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    }, { timeoutMs: TIMEOUTS.n8nApiRead, allowHttp: process.env.NODE_ENV !== 'production' });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to apply fix to n8n (${res.status}): ${body}`);
    }
}

// ─── Error enrichment (backfill missing error details from n8n) ──────────

async function fetchExecutionFromN8n(baseUrl: string, apiKey: string, remoteExecutionId: string): Promise<any> {
    // Sanitize API key for HTTP headers: replace common Unicode lookalikes from copy-paste
    const safeKey = apiKey
        .replace(/[\u2014\u2013]/g, '-')   // em/en dash → hyphen
        .replace(/[\u2018\u2019]/g, "'")    // smart single quotes
        .replace(/[\u201C\u201D]/g, '"')    // smart double quotes
        .replace(/[^\x00-\xFF]/g, '');      // strip any remaining non-Latin1 chars
    const url = `${baseUrl}/api/v1/executions/${remoteExecutionId}?includeData=true`;
    const res = await safeFetch(url, {
        headers: {
            'X-N8N-API-KEY': safeKey,
            'Accept': 'application/json',
        },
    }, { timeoutMs: TIMEOUTS.n8nApiExecution, allowHttp: process.env.NODE_ENV !== 'production' });
    if (!res.ok) {
        console.warn(`[enrich] n8n API returned ${res.status} for execution ${remoteExecutionId}`);
        return null;
    }
    return res.json();
}

/**
 * If an error execution is missing error_message or error_node, attempt to
 * fetch the details from n8n's single-execution API and persist them.
 * Returns the (possibly updated) error_message and error_node.
 */
export async function enrichErrorDetails(executionId: string): Promise<{ error_message: string | null; error_node: string | null; reason?: string }> {
    const result = await query(`
        SELECT e.id, e.error_message, e.error_node, e.remote_execution_id,
               i.base_url, i.n8n_api_key_encrypted, i.name as instance_name
        FROM executions e
        JOIN workflows w ON e.workflow_id = w.id
        JOIN instances i ON w.instance_id = i.id
        WHERE e.id = $1
    `, [executionId]);

    if (result.rows.length === 0) {
        console.warn(`[enrich] Execution ${executionId} not found`);
        return { error_message: null, error_node: null, reason: 'execution_not_found' };
    }
    const exec = result.rows[0];

    // Already has both fields — nothing to enrich
    if (exec.error_message && exec.error_node) {
        return { error_message: exec.error_message, error_node: exec.error_node };
    }

    // Need base_url + API key to fetch from n8n
    if (!exec.n8n_api_key_encrypted) {
        console.warn(`[enrich] Instance "${exec.instance_name}" has no n8n API key — cannot enrich execution ${exec.remote_execution_id}`);
        return { error_message: exec.error_message, error_node: exec.error_node, reason: 'no_api_key' };
    }
    if (!exec.base_url) {
        console.warn(`[enrich] Instance "${exec.instance_name}" has no base URL — cannot enrich`);
        return { error_message: exec.error_message, error_node: exec.error_node, reason: 'no_base_url' };
    }
    if (!exec.remote_execution_id) {
        return { error_message: exec.error_message, error_node: exec.error_node, reason: 'no_remote_id' };
    }

    try {
        const n8nApiKey = decrypt(exec.n8n_api_key_encrypted);
        console.log(`[enrich] Fetching execution ${exec.remote_execution_id} from ${exec.base_url}`);
        const n8nExec = await fetchExecutionFromN8n(exec.base_url, n8nApiKey, exec.remote_execution_id);
        if (!n8nExec) {
            return { error_message: exec.error_message, error_node: exec.error_node, reason: 'n8n_api_failed' };
        }

        // Extract error details from n8n's response
        // n8n stores error in data.resultData.error (with includeData=true)
        const errorMsg = n8nExec.data?.resultData?.error?.message
            || n8nExec.data?.resultData?.error?.description
            || n8nExec.error?.message
            || null;
        const errorNode = n8nExec.data?.resultData?.lastNodeExecuted
            || n8nExec.lastNodeExecuted
            || null;

        console.log(`[enrich] Extracted: errorMsg=${errorMsg ? 'yes' : 'null'}, errorNode=${errorNode || 'null'}`);

        const newMsg = exec.error_message || errorMsg;
        const newNode = exec.error_node || errorNode;

        // Persist enriched data if we found anything new
        if (newMsg !== exec.error_message || newNode !== exec.error_node) {
            await query(
                `UPDATE executions SET error_message = COALESCE($1, error_message), error_node = COALESCE($2, error_node) WHERE id = $3`,
                [newMsg, newNode, executionId]
            );
            console.log(`[enrich] Updated execution ${exec.remote_execution_id} with enriched error details`);
        }

        return { error_message: newMsg, error_node: newNode, reason: (newMsg || newNode) ? undefined : 'no_error_in_n8n' };
    } catch (err) {
        console.warn('[enrich] Error enrichment failed:', (err as Error).message);
        return { error_message: exec.error_message, error_node: exec.error_node, reason: 'fetch_error' };
    }
}

// ─── Diagnosis Service (lightweight, no workflow fetch needed) ─────────────

const DIAGNOSIS_SYSTEM_PROMPT = `You are an expert n8n workflow error diagnostician. You analyze workflow execution failures and provide structured diagnostic reports.

${N8N_KNOWLEDGE_BASE}

Given the error details, produce a structured diagnosis. You do NOT have access to the full workflow JSON — diagnose based on the error message, failed node name, and workflow context.

Response format (JSON only, no markdown code fences):
{
  "diagnosis": "Clear 1-2 sentence explanation of what went wrong",
  "cause": "Root cause analysis — why this error occurred, referencing specific n8n patterns if applicable",
  "resolution": "Step-by-step instructions for the user to fix this, or what the AI auto-fix would do",
  "category": "One of: code_node_error, expression_error, missing_config, type_mismatch, null_reference, api_error, credential_error, rate_limit, network_error, data_format, unknown",
  "severity": "One of: critical, high, medium, low",
  "fixable": true/false (whether AI could fix this by modifying node configuration)
}

IMPORTANT:
- Return ONLY valid JSON
- Be specific — reference the actual node name and error message in your diagnosis
- For Code node errors, identify the specific pattern (missing return, wrong format, expression syntax confusion, null access)
- For expression errors, identify whether it's missing brackets, webhook .body issue, case sensitivity, etc.
- severity: critical = workflow completely broken, high = functionality impaired, medium = intermittent/conditional, low = cosmetic/best-practice`;

export async function diagnoseError(executionId: string, force = false): Promise<DiagnosisResult> {
    const execResult = await query(`
        SELECT e.id, e.status, e.error_message, e.error_node, e.remote_execution_id, e.ai_diagnosis,
               w.name as workflow_name, w.remote_id as workflow_remote_id, w.node_count,
               i.name as instance_name, i.base_url
        FROM executions e
        JOIN workflows w ON e.workflow_id = w.id
        JOIN instances i ON w.instance_id = i.id
        WHERE e.id = $1
    `, [executionId]);

    if (execResult.rows.length === 0) {
        throw new Error('Execution not found');
    }

    const exec = execResult.rows[0];

    if (exec.status !== 'error') {
        throw new Error('Only failed executions can be diagnosed');
    }

    // Return cached diagnosis if available (unless force re-diagnose)
    if (exec.ai_diagnosis && !force) {
        return exec.ai_diagnosis as DiagnosisResult;
    }

    // Auto-enrich: if error_message or error_node is missing, try to fetch from n8n
    if (!exec.error_message || !exec.error_node) {
        const enriched = await enrichErrorDetails(executionId);
        if (enriched.error_message) exec.error_message = enriched.error_message;
        if (enriched.error_node) exec.error_node = enriched.error_node;
    }

    const anthropicKey = await getSetting('anthropic_api_key');
    if (!anthropicKey) {
        throw new Error('Anthropic API key not configured. Go to Settings → AI Integration.');
    }

    const userMessage = [
        `Workflow: "${exec.workflow_name}" (ID: ${exec.workflow_remote_id})`,
        `Instance: "${exec.instance_name}" (${exec.base_url || 'no URL'})`,
        `Execution ID: ${exec.remote_execution_id || 'N/A'}`,
        `Node Count: ${exec.node_count || 'unknown'}`,
        `Failed Node: ${exec.error_node || 'Unknown'}`,
        `Error Message: ${exec.error_message || 'No error message available'}`,
    ].join('\n');

    const { text, token_usage } = await callAnthropicApi(anthropicKey, DIAGNOSIS_SYSTEM_PROMPT, userMessage, 2048, 30000);

    const parsed = parseAiJsonResponse(text);
    const result: DiagnosisResult = parsed ? {
        diagnosis: parsed.diagnosis || 'No diagnosis provided',
        cause: parsed.cause || 'Unknown cause',
        resolution: parsed.resolution || 'No resolution available',
        category: parsed.category || 'unknown',
        severity: parsed.severity || 'medium',
        fixable: !!parsed.fixable,
        mode: 'simple',
        token_usage,
    } : {
        diagnosis: text || 'AI response could not be parsed',
        cause: 'Unable to determine',
        resolution: 'Review the error message manually',
        category: 'unknown',
        severity: 'medium',
        fixable: false,
        mode: 'simple',
        token_usage,
    };

    // Persist diagnosis on execution row + log token usage
    await Promise.all([
        query(`UPDATE executions SET ai_diagnosis = $1 WHERE id = $2`, [JSON.stringify(result), executionId]),
        logTokenUsage(executionId, 'diagnosis', token_usage),
    ]);

    return result;
}

// ─── Complex Diagnosis (agentic multi-turn with tool_use) ─────────────────

const DIAGNOSIS_AGENT_PROMPT = `You are an expert n8n workflow error diagnostician with tools to inspect workflow nodes and execution data.

${N8N_KNOWLEDGE_BASE}

You have been given:
- Error metadata (workflow name, failed node, error message)
- A workflow map showing all nodes, their types, and connections

You have tools to request:
- Specific node configurations (JSON) via get_nodes
- Execution runtime data for specific nodes (input/output) via get_node_execution_data
- Connected nodes (upstream/downstream) via get_connected_nodes
- The full workflow JSON (expensive — use only if needed) via get_full_workflow

STRATEGY:
1. Start by requesting the errored node's config and any nodes referenced in the error message
2. Use the workflow map to identify likely upstream causes
3. Request additional nodes only if the root cause isn't clear
4. Request execution data if you need to see what data actually flowed through a node
5. Once you have enough context, produce your diagnosis in ONE shot — do NOT call any more tools

FINAL RESPONSE FORMAT (JSON only, no tool calls, no markdown code fences):
{
  "diagnosis": "Clear 1-2 sentence explanation of what went wrong",
  "cause": "Root cause analysis — why this error occurred, referencing specific n8n patterns if applicable",
  "resolution": "Step-by-step instructions for the user to fix this, or what the AI auto-fix would do",
  "category": "One of: code_node_error, expression_error, missing_config, type_mismatch, null_reference, api_error, credential_error, rate_limit, network_error, data_format, unknown",
  "severity": "One of: critical, high, medium, low",
  "fixable": true/false (whether AI could fix this by modifying node configuration)
}

IMPORTANT:
- When you are ready to diagnose, return ONLY valid JSON with no tool calls
- Be specific — reference the actual node name and error message in your diagnosis
- For Code node errors, identify the specific pattern (missing return, wrong format, expression syntax confusion, null access)
- For expression errors, identify whether it's missing brackets, webhook .body issue, case sensitivity, etc.
- severity: critical = workflow completely broken, high = functionality impaired, medium = intermittent/conditional, low = cosmetic/best-practice`;

function getDiagnosisTools(nodeCount: number, estTokens: number): AgentTool[] {
    return [
        {
            name: 'get_nodes',
            description: 'Get the full JSON configuration of specific workflow nodes by name. Returns parameters, expressions, credentials references, and all settings.',
            input_schema: {
                type: 'object',
                properties: {
                    node_names: { type: 'array', items: { type: 'string' }, description: 'Node names to retrieve' },
                },
                required: ['node_names'],
            },
        },
        {
            name: 'get_node_execution_data',
            description: 'Get the runtime input/output data that flowed through specific nodes during the failed execution. Shows what data the node actually received and produced.',
            input_schema: {
                type: 'object',
                properties: {
                    node_names: { type: 'array', items: { type: 'string' }, description: 'Node names to get execution data for' },
                },
                required: ['node_names'],
            },
        },
        {
            name: 'get_connected_nodes',
            description: 'Get names of nodes connected to a specific node. Use to trace data flow upstream (inputs) or downstream (outputs).',
            input_schema: {
                type: 'object',
                properties: {
                    node_name: { type: 'string', description: 'Node name to find connections for' },
                    direction: { type: 'string', enum: ['upstream', 'downstream', 'both'], description: 'Direction to search (default: both)' },
                    hops: { type: 'integer', minimum: 1, maximum: 5, description: 'Number of hops to traverse (default: 1)' },
                },
                required: ['node_name'],
            },
        },
        {
            name: 'get_full_workflow',
            description: `Get the entire workflow JSON. EXPENSIVE — only use if you cannot diagnose with targeted node requests. The workflow has ${nodeCount} nodes (~${estTokens.toLocaleString()} estimated tokens).`,
            input_schema: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    ];
}

export async function complexDiagnoseError(executionId: string, force = false): Promise<DiagnosisResult> {
    // 1. Load execution metadata from DB
    const execResult = await query(`
        SELECT e.id, e.status, e.error_message, e.error_node, e.remote_execution_id, e.ai_diagnosis,
               w.name as workflow_name, w.remote_id as workflow_remote_id, w.node_count,
               i.name as instance_name, i.base_url, i.n8n_api_key_encrypted
        FROM executions e
        JOIN workflows w ON e.workflow_id = w.id
        JOIN instances i ON w.instance_id = i.id
        WHERE e.id = $1
    `, [executionId]);

    if (execResult.rows.length === 0) {
        throw new Error('Execution not found');
    }

    const exec = execResult.rows[0];

    if (exec.status !== 'error') {
        throw new Error('Only failed executions can be diagnosed');
    }

    // Return cached diagnosis if available (unless force re-diagnose)
    if (exec.ai_diagnosis && !force) {
        return exec.ai_diagnosis as DiagnosisResult;
    }

    // 2. Auto-enrich
    if (!exec.error_message || !exec.error_node) {
        const enriched = await enrichErrorDetails(executionId);
        if (enriched.error_message) exec.error_message = enriched.error_message;
        if (enriched.error_node) exec.error_node = enriched.error_node;
    }

    // 3. Validate prerequisites
    const anthropicKey = await getSetting('anthropic_api_key');
    if (!anthropicKey) {
        throw new Error('Anthropic API key not configured. Go to Settings → AI Integration.');
    }
    if (!exec.base_url) {
        throw new Error(`Instance "${exec.instance_name}" has no base URL configured. Required for complex diagnosis.`);
    }
    if (!exec.n8n_api_key_encrypted) {
        throw new Error(`Instance "${exec.instance_name}" has no n8n API key configured. Required for complex diagnosis.`);
    }

    const n8nApiKey = decrypt(exec.n8n_api_key_encrypted);

    // 4. Fetch workflow JSON from n8n (strip staticData/pinData for AI)
    const rawWorkflowJson = await fetchWorkflowFromN8n(exec.base_url, n8nApiKey, exec.workflow_remote_id);
    const workflowJson = sanitizeWorkflowForAI(rawWorkflowJson);

    // 5. Fetch execution data from n8n (if available)
    let executionData: any = null;
    if (exec.remote_execution_id) {
        try {
            executionData = await fetchExecutionFromN8n(exec.base_url, n8nApiKey, exec.remote_execution_id);
        } catch (err) {
            console.warn(`[diagnose-complex] Could not fetch execution data: ${(err as Error).message}`);
        }
    }

    // 6. Build initial message with workflow map
    const workflowMapStr = getWorkflowMap(workflowJson, exec.error_node || undefined);
    const nodeCount = (workflowJson?.nodes || []).length;
    const estTokens = estimateTokens(workflowJson);

    const initialMessage = [
        `Workflow: "${exec.workflow_name}" (ID: ${exec.workflow_remote_id})`,
        `Instance: "${exec.instance_name}" (${exec.base_url})`,
        `Execution ID: ${exec.remote_execution_id || 'N/A'}`,
        `Failed Node: ${exec.error_node || 'Unknown'}`,
        `Error Message: ${exec.error_message || 'No error message available'}`,
        '',
        workflowMapStr,
    ].join('\n');

    // 7. Define tools + executor
    const tools = getDiagnosisTools(nodeCount, estTokens);

    const toolExecutor = async (toolName: string, input: Record<string, any>): Promise<string> => {
        switch (toolName) {
            case 'get_nodes': {
                const { nodes, notFound } = extractNodesFromWorkflow(workflowJson, input.node_names || []);
                return JSON.stringify({ nodes, notFound });
            }
            case 'get_node_execution_data': {
                if (!executionData) {
                    return JSON.stringify({ error: 'Execution data not available for this execution' });
                }
                const results = extractNodeResultsFromExecution(executionData, input.node_names || []);
                return JSON.stringify(results);
            }
            case 'get_connected_nodes': {
                const connected = getConnectedNodes(
                    workflowJson,
                    input.node_name,
                    input.direction || 'both',
                    input.hops || 1
                );
                return JSON.stringify({ node: input.node_name, direction: input.direction || 'both', connected });
            }
            case 'get_full_workflow': {
                return JSON.stringify(workflowJson);
            }
            default:
                return JSON.stringify({ error: `Unknown tool: ${toolName}` });
        }
    };

    // 8. Run the agentic diagnosis loop
    console.log(`[diagnose-complex] Starting agentic diagnosis for execution ${executionId} (${nodeCount} nodes, ~${estTokens.toLocaleString()} est. full-workflow tokens)`);

    const agentResult = await runAgentLoop({
        apiKey: anthropicKey,
        systemPrompt: DIAGNOSIS_AGENT_PROMPT,
        tools,
        initialMessage,
        toolExecutor,
        maxTurns: 5,
        maxOutputTokens: 2048,
        timeoutMs: 60000,
    });

    console.log(`[diagnose-complex] Completed in ${agentResult.turns} turn(s), ${agentResult.totalTokenUsage.input_tokens + agentResult.totalTokenUsage.output_tokens} total tokens`);

    // 9. Parse final JSON response
    const token_usage = agentResult.totalTokenUsage;
    const parsed = parseAiJsonResponse(agentResult.finalText);
    const result: DiagnosisResult = parsed ? {
        diagnosis: parsed.diagnosis || 'No diagnosis provided',
        cause: parsed.cause || 'Unknown cause',
        resolution: parsed.resolution || 'No resolution available',
        category: parsed.category || 'unknown',
        severity: parsed.severity || 'medium',
        fixable: !!parsed.fixable,
        mode: 'complex',
        token_usage,
    } : {
        diagnosis: agentResult.finalText || 'AI response could not be parsed',
        cause: 'Unable to determine',
        resolution: 'Review the error message manually',
        category: 'unknown',
        severity: 'medium',
        fixable: false,
        mode: 'complex',
        token_usage,
    };

    // 10. Persist diagnosis on execution row + log token usage
    await Promise.all([
        query(`UPDATE executions SET ai_diagnosis = $1 WHERE id = $2`, [JSON.stringify(result), executionId]),
        logTokenUsage(executionId, 'diagnosis', token_usage),
    ]);

    return result;
}

// ─── Agentic Fix Service ──────────────────────────────────────────────────

const FIX_AGENT_PROMPT = `You are an expert n8n workflow fixer. A diagnosis has already been performed — your job is to apply a targeted fix.

${N8N_KNOWLEDGE_BASE}

You have been given:
- Error metadata (workflow name, failed node, error message)
- The prior AI diagnosis (root cause, resolution steps, fixability assessment)
- A workflow map showing all nodes, their types, and connections

You have tools to request:
- Specific node configurations (JSON) via get_nodes
- Connected nodes (upstream/downstream) via get_connected_nodes
- The full workflow JSON (expensive — use only if needed) via get_full_workflow

And tools to validate and submit your fix:
- validate_fix: Check your proposed changes BEFORE submitting (catches missing credentials, bad references, etc.)
- submit_fix: Submit the final fix (auto-validates — will reject if errors found)

STRATEGY:
1. Use the diagnosis to identify which node(s) need modification — DO NOT re-diagnose
2. Request ONLY the node(s) you need to fix via get_nodes (typically 1-3 nodes)
3. If you need to understand data flow, request connected nodes
4. DO NOT request the full workflow unless absolutely necessary
5. Apply minimal, targeted changes. Preserve ALL credentials, IDs, and positions exactly as they are.
6. Call validate_fix with your proposed changes, then submit_fix if validation passes.
7. You MUST call submit_fix within your first 4-5 tool calls. Do not over-investigate.
8. If you determine the error CANNOT be fixed by modifying node JSON (e.g., it's an execution-path issue, missing credentials, or external service error), respond with the error JSON immediately — do NOT waste turns inspecting nodes

AFTER calling submit_fix, produce a final text response (JSON, no tool calls):
{
  "fix_description": "What you changed and why",
  "nodes_modified": ["node name 1", "node name 2"]
}

If you determine the fix cannot be applied, return:
{
  "fix_description": null,
  "error": "Why the fix could not be applied"
}

IMPORTANT:
- Return ONLY valid JSON as your final response
- Preserve all credentials references exactly as they are
- Do NOT change node IDs, names, or positions unless necessary for the fix
- For Code nodes: ensure return format is [{json: {...}}], add null checks, fix syntax
- For expression errors: fix brackets, .body access, node name casing, property paths
- For missing fields: add required fields with sensible defaults`;

/** Tool definitions for fix agent (shared tools + submit_fix) */
function getFixTools(nodeCount: number, estTokens: number): AgentTool[] {
    return [
        {
            name: 'get_nodes',
            description: 'Get the full JSON configuration of specific workflow nodes by name. Returns parameters, expressions, credentials references, and all settings.',
            input_schema: {
                type: 'object',
                properties: {
                    node_names: { type: 'array', items: { type: 'string' }, description: 'Node names to retrieve' },
                },
                required: ['node_names'],
            },
        },
        {
            name: 'get_connected_nodes',
            description: 'Get names of nodes connected to a specific node. Use to trace data flow upstream (inputs) or downstream (outputs).',
            input_schema: {
                type: 'object',
                properties: {
                    node_name: { type: 'string', description: 'Node name to find connections for' },
                    direction: { type: 'string', enum: ['upstream', 'downstream', 'both'], description: 'Direction to search (default: both)' },
                    hops: { type: 'integer', minimum: 1, maximum: 5, description: 'Number of hops to traverse (default: 1)' },
                },
                required: ['node_name'],
            },
        },
        {
            name: 'get_full_workflow',
            description: `Get the entire workflow JSON. EXPENSIVE — only use if you cannot fix with targeted node requests. The workflow has ${nodeCount} nodes (~${estTokens.toLocaleString()} estimated tokens).`,
            input_schema: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
        {
            name: 'validate_fix',
            description: 'Validate proposed fixed nodes BEFORE submitting. Checks: node names exist, credentials preserved, expression references valid, node types unchanged. Call this before submit_fix to catch mistakes.',
            input_schema: {
                type: 'object',
                properties: {
                    fixed_nodes: { type: 'array', items: { type: 'object' }, description: 'Complete JSON of modified node(s) to validate' },
                },
                required: ['fixed_nodes'],
            },
        },
        {
            name: 'submit_fix',
            description: 'Submit your validated fix. Provide ONLY the modified node(s) with their complete JSON. Do not include unmodified nodes. Call validate_fix first.',
            input_schema: {
                type: 'object',
                properties: {
                    fix_description: { type: 'string', description: 'What you changed and why' },
                    fixed_nodes: { type: 'array', items: { type: 'object' }, description: 'Complete JSON of modified node(s) only' },
                },
                required: ['fix_description', 'fixed_nodes'],
            },
        },
    ];
}

// Check daily fix limit
async function checkDailyLimit(instanceId: string): Promise<boolean> {
    const maxStr = await getSetting('max_fixes_per_day');
    const max = parseInt(maxStr || '10');

    const result = await query(
        `SELECT COUNT(*)::int as count FROM ai_fix_attempts 
         WHERE instance_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
        [instanceId]
    );
    return result.rows[0].count < max;
}

export async function attemptAiFix(
    executionId: string,
    triggeredBy: 'manual' | 'auto' = 'manual'
): Promise<FixResult> {
    // 1. Get execution details with instance info + diagnosis
    const execResult = await query(`
        SELECT e.id, e.error_message, e.error_node, e.remote_execution_id, e.ai_diagnosis,
               w.remote_id as workflow_remote_id, w.name as workflow_name,
               i.id as instance_id, i.name as instance_name, i.base_url, i.n8n_api_key_encrypted
        FROM executions e
        JOIN workflows w ON e.workflow_id = w.id
        JOIN instances i ON w.instance_id = i.id
        WHERE e.id = $1
    `, [executionId]);

    if (execResult.rows.length === 0) {
        throw new Error('Execution not found');
    }

    const exec = execResult.rows[0];

    // 2. Check diagnosis exists — required before fix
    if (!exec.ai_diagnosis) {
        throw new Error('Run diagnosis first. AI Fix requires a prior diagnosis.');
    }

    const diagnosis: DiagnosisResult = exec.ai_diagnosis as DiagnosisResult;

    // 3. If diagnosis says not fixable, return early (zero fix tokens)
    if (diagnosis.fixable === false) {
        return {
            status: 'rejected',
            diagnosis: diagnosis.diagnosis,
            fixDescription: `AI diagnosis determined this error is not fixable: ${diagnosis.cause}`,
            fixApplied: false,
        };
    }

    // 4. Validate prerequisites
    if (!exec.base_url) {
        throw new Error(`Instance "${exec.instance_name}" has no base URL configured`);
    }
    if (!exec.n8n_api_key_encrypted) {
        throw new Error(`Instance "${exec.instance_name}" has no n8n API key configured. Add one in instance settings.`);
    }

    const anthropicKey = await getSetting('anthropic_api_key');
    if (!anthropicKey) {
        throw new Error('Anthropic API key not configured. Go to Settings → AI Integration.');
    }

    // 5. Check daily limit
    const withinLimit = await checkDailyLimit(exec.instance_id);
    if (!withinLimit) {
        throw new Error('Daily AI fix limit reached. Increase the limit in Settings or wait 24 hours.');
    }

    // 6. Create fix attempt record
    const attemptResult = await query(
        `INSERT INTO ai_fix_attempts (execution_id, instance_id, workflow_remote_id, workflow_name, error_message, error_node, status, triggered_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', $7)
         RETURNING id`,
        [executionId, exec.instance_id, exec.workflow_remote_id, exec.workflow_name, exec.error_message, exec.error_node, triggeredBy]
    );
    const attemptId = attemptResult.rows[0].id;

    try {
        // 7. Decrypt n8n API key & fetch workflow
        const n8nApiKey = decrypt(exec.n8n_api_key_encrypted);
        const rawWorkflowJson = await fetchWorkflowFromN8n(exec.base_url, n8nApiKey, exec.workflow_remote_id);
        const workflowJson = sanitizeWorkflowForAI(rawWorkflowJson);

        // 8. Build initial message with diagnosis context + workflow map
        const workflowMapStr = getWorkflowMap(workflowJson, exec.error_node || undefined);
        const nodeCount = (workflowJson?.nodes || []).length;
        const estTokens = estimateTokens(workflowJson);

        const initialMessage = [
            `Workflow: "${exec.workflow_name}" (ID: ${exec.workflow_remote_id})`,
            `Instance: "${exec.instance_name}" (${exec.base_url})`,
            `Execution ID: ${exec.remote_execution_id || 'N/A'}`,
            `Failed Node: ${exec.error_node || 'Unknown'}`,
            `Error Message: ${exec.error_message || 'No error message available'}`,
            '',
            '--- PRIOR AI DIAGNOSIS ---',
            `Diagnosis: ${diagnosis.diagnosis}`,
            `Cause: ${diagnosis.cause}`,
            `Resolution: ${diagnosis.resolution}`,
            `Category: ${diagnosis.category}`,
            `Severity: ${diagnosis.severity}`,
            '',
            workflowMapStr,
        ].join('\n');

        // 9. Define tools + executor with submit_fix capture
        const tools = getFixTools(nodeCount, estTokens);
        let capturedFix: { fix_description: string; fixed_nodes: any[] } | null = null;

        const toolExecutor = async (toolName: string, input: Record<string, any>): Promise<string> => {
            switch (toolName) {
                case 'get_nodes': {
                    const { nodes, notFound } = extractNodesFromWorkflow(workflowJson, input.node_names || []);
                    return JSON.stringify({ nodes, notFound });
                }
                case 'get_connected_nodes': {
                    const connected = getConnectedNodes(
                        workflowJson,
                        input.node_name,
                        input.direction || 'both',
                        input.hops || 1
                    );
                    return JSON.stringify({ node: input.node_name, direction: input.direction || 'both', connected });
                }
                case 'get_full_workflow': {
                    return JSON.stringify(workflowJson);
                }
                case 'validate_fix': {
                    const validation = validateFixedNodes(workflowJson, input.fixed_nodes || []);
                    console.log(`[fix] validate_fix: ${validation.valid ? 'PASS' : 'FAIL'} (${validation.errors.length} errors, ${validation.warnings.length} warnings)`);
                    return JSON.stringify(validation);
                }
                case 'submit_fix': {
                    // Auto-validate before accepting
                    const preCheck = validateFixedNodes(workflowJson, input.fixed_nodes || []);
                    if (!preCheck.valid) {
                        console.warn(`[fix] submit_fix rejected: ${preCheck.errors.join('; ')}`);
                        return JSON.stringify({ status: 'rejected', errors: preCheck.errors, warnings: preCheck.warnings, message: 'Fix has validation errors. Please fix the issues and try again.' });
                    }
                    capturedFix = {
                        fix_description: input.fix_description || 'No description',
                        fixed_nodes: input.fixed_nodes || [],
                    };
                    return JSON.stringify({ status: 'accepted', nodes_received: capturedFix.fixed_nodes.length, warnings: preCheck.warnings });
                }
                default:
                    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
            }
        };

        // 10. Run the agentic fix loop
        console.log(`[fix] Starting agentic fix for execution ${executionId} (${nodeCount} nodes, ~${estTokens.toLocaleString()} est. full-workflow tokens)`);

        const agentResult = await runAgentLoop({
            apiKey: anthropicKey,
            systemPrompt: FIX_AGENT_PROMPT,
            tools,
            initialMessage,
            toolExecutor,
            maxTurns: 8,
            maxOutputTokens: 4096,
            timeoutMs: 90000,
        });

        const token_usage: TokenUsage = agentResult.totalTokenUsage;
        console.log(`[fix] Completed in ${agentResult.turns} turn(s), ${token_usage.input_tokens + token_usage.output_tokens} total tokens`);

        // 11. Log token usage
        await logTokenUsage(executionId, 'fix', token_usage);

        // 12. Apply captured fix if submit_fix was called
        let fixApplied = false;
        const parsedFinal = parseAiJsonResponse(agentResult.finalText);
        const rawFixDesc = parsedFinal?.error || parsedFinal?.fix_description || parsedFinal?.reason || agentResult.finalText
            || `AI agent exhausted ${agentResult.turns} turns inspecting the workflow without submitting a fix. This error may require manual intervention.`;
        let fixDesc = typeof rawFixDesc === 'string' && rawFixDesc.length > 500 ? rawFixDesc.slice(0, 500) + '…' : String(rawFixDesc);
        const fix = capturedFix as { fix_description: string; fixed_nodes: any[] } | null;

        if (fix && fix.fixed_nodes.length > 0) {
            fixDesc = fix.fix_description;
            try {
                const updatedWorkflow = replaceNodesInWorkflow(rawWorkflowJson, fix.fixed_nodes);
                await applyFixToN8n(exec.base_url, n8nApiKey, exec.workflow_remote_id, updatedWorkflow);
                fixApplied = true;
            } catch (applyErr: any) {
                await query(
                    `UPDATE ai_fix_attempts SET status = 'failed', ai_diagnosis = $1, ai_fix_description = $2, completed_at = NOW() WHERE id = $3`,
                    [diagnosis.diagnosis, `Fix generated but failed to apply: ${applyErr.message}`, attemptId]
                );
                return {
                    status: 'failed',
                    diagnosis: diagnosis.diagnosis,
                    fixDescription: `Fix generated but failed to apply: ${applyErr.message}`,
                    fixApplied: false,
                    token_usage,
                };
            }
        }

        // 13. Update attempt record
        const status = fixApplied ? 'success' : (capturedFix ? 'failed' : 'rejected');

        await query(
            `UPDATE ai_fix_attempts SET status = $1, ai_diagnosis = $2, ai_fix_description = $3, fix_applied = $4, completed_at = NOW() WHERE id = $5`,
            [status, diagnosis.diagnosis, fixDesc, fixApplied, attemptId]
        );

        return {
            status,
            diagnosis: diagnosis.diagnosis,
            fixDescription: fixDesc,
            fixApplied,
            token_usage,
        };

    } catch (err: any) {
        await query(
            `UPDATE ai_fix_attempts SET status = 'failed', ai_diagnosis = $1, completed_at = NOW() WHERE id = $2`,
            [err.message, attemptId]
        );
        throw err;
    }
}
