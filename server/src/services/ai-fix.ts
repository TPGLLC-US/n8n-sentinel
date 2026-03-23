import { query } from '../db';
import { getSetting } from '../routes/settings';
import { decrypt } from './encryption';
import { safeFetch } from '../lib/safe-fetch';
import { runAgentLoop, AgentTool } from './ai-agent';
import {
    extractNodesFromWorkflow,
    getConnectedNodes,
    getWorkflowMap,
    estimateTokens,
    extractNodeResultsFromExecution,
    sanitizeWorkflowForAI,
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
        throw new Error(`Anthropic API error (${res.status}): ${body}`);
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
    }, { timeoutMs: 15000, allowHttp: process.env.NODE_ENV !== 'production' });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to fetch workflow from n8n (${res.status}): ${body}`);
    }
    return res.json();
}

async function applyFixToN8n(baseUrl: string, apiKey: string, workflowRemoteId: string, updatedNodes: any[]): Promise<void> {
    const url = `${baseUrl}/api/v1/workflows/${workflowRemoteId}`;
    const res = await safeFetch(url, {
        method: 'PATCH',
        headers: {
            'X-N8N-API-KEY': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nodes: updatedNodes }),
    }, { timeoutMs: 15000, allowHttp: process.env.NODE_ENV !== 'production' });
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
    }, { timeoutMs: 10000, allowHttp: process.env.NODE_ENV !== 'production' });
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

// ─── Fix Service (heavy — fetches workflow, applies changes) ──────────────

const FIX_SYSTEM_PROMPT = `You are an expert n8n workflow debugger and fixer. You receive a failed workflow's full JSON and the error details. Your job is to diagnose the issue AND apply a fix.

${N8N_KNOWLEDGE_BASE}

Your task:
1. Diagnose WHY the workflow failed based on the error message and node configuration
2. If fixable by modifying node parameters, provide the COMPLETE updated nodes array with your fix applied
3. If NOT fixable by changing node config (credentials, API outages, rate limits, network), say so clearly

Response format (JSON only, no markdown code fences):
{
  "diagnosis": "Clear explanation of what went wrong and why",
  "fixable": true/false,
  "fix_description": "What you changed and why (null if not fixable)",
  "fixed_nodes": [...updated nodes array...] or null if not fixable
}

IMPORTANT:
- Return ONLY valid JSON, no markdown code fences
- The fixed_nodes must be the COMPLETE nodes array with modifications applied
- Do NOT change node IDs, names, or positions unless necessary for the fix
- Only modify the specific node(s) that caused the error
- Preserve all credentials references exactly as they are
- For Code nodes: ensure return format is [{json: {...}}], add null checks, fix syntax
- For expression errors: fix brackets, .body access, node name casing, property paths
- For missing fields: add required fields with sensible defaults`;

async function callAnthropicForFix(apiKey: string, errorContext: string, workflowJson: any): Promise<{ diagnosis: string; fixedNodes: any[] | null; token_usage: TokenUsage }> {
    const userMessage = `WORKFLOW ERROR DETAILS:\n${errorContext}\n\nFULL WORKFLOW JSON:\n${JSON.stringify(workflowJson, null, 2)}`;

    const { text, token_usage } = await callAnthropicApi(apiKey, FIX_SYSTEM_PROMPT, userMessage, 8192, 120000);

    const parsed = parseAiJsonResponse(text);
    if (!parsed) {
        return { diagnosis: text || 'AI response could not be parsed', fixedNodes: null, token_usage };
    }

    return {
        diagnosis: parsed.diagnosis || 'No diagnosis provided',
        fixedNodes: parsed.fixable && parsed.fixed_nodes ? parsed.fixed_nodes : null,
        token_usage,
    };
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

// Main entry point: attempt to fix a workflow error
export async function attemptAiFix(
    executionId: string,
    triggeredBy: 'manual' | 'auto' = 'manual'
): Promise<FixResult> {
    // 1. Get execution details with instance info
    const execResult = await query(`
        SELECT e.id, e.error_message, e.error_node, e.remote_execution_id,
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

    // 2. Validate prerequisites
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

    // 3. Check daily limit
    const withinLimit = await checkDailyLimit(exec.instance_id);
    if (!withinLimit) {
        throw new Error('Daily AI fix limit reached. Increase the limit in Settings or wait 24 hours.');
    }

    // 4. Create fix attempt record
    const attemptResult = await query(
        `INSERT INTO ai_fix_attempts (execution_id, instance_id, workflow_remote_id, workflow_name, error_message, error_node, status, triggered_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', $7)
         RETURNING id`,
        [executionId, exec.instance_id, exec.workflow_remote_id, exec.workflow_name, exec.error_message, exec.error_node, triggeredBy]
    );
    const attemptId = attemptResult.rows[0].id;

    try {
        // 5. Decrypt n8n API key
        const n8nApiKey = decrypt(exec.n8n_api_key_encrypted);

        // 6. Fetch workflow from n8n
        const workflow = await fetchWorkflowFromN8n(exec.base_url, n8nApiKey, exec.workflow_remote_id);

        // 7. Build error context
        const errorContext = [
            `Workflow: "${exec.workflow_name}" (ID: ${exec.workflow_remote_id})`,
            `Instance: "${exec.instance_name}" (${exec.base_url})`,
            `Execution ID: ${exec.remote_execution_id}`,
            `Failed Node: ${exec.error_node || 'Unknown'}`,
            `Error Message: ${exec.error_message || 'No error message'}`,
        ].join('\n');

        // 8. Call Anthropic
        const aiResult = await callAnthropicForFix(anthropicKey, errorContext, workflow);

        // 8b. Log token usage
        await logTokenUsage(executionId, 'fix', aiResult.token_usage);

        // 9. Apply fix if available
        let fixApplied = false;
        if (aiResult.fixedNodes) {
            try {
                await applyFixToN8n(exec.base_url, n8nApiKey, exec.workflow_remote_id, aiResult.fixedNodes);
                fixApplied = true;
            } catch (applyErr: any) {
                // Record the failed application but don't throw — the diagnosis is still valuable
                await query(
                    `UPDATE ai_fix_attempts SET status = 'failed', ai_diagnosis = $1, ai_fix_description = $2, completed_at = NOW() WHERE id = $3`,
                    [aiResult.diagnosis, `Fix generated but failed to apply: ${applyErr.message}`, attemptId]
                );
                return {
                    status: 'failed',
                    diagnosis: aiResult.diagnosis,
                    fixDescription: `Fix generated but failed to apply: ${applyErr.message}`,
                    fixApplied: false,
                    token_usage: aiResult.token_usage,
                };
            }
        }

        // 10. Update attempt record
        const status = fixApplied ? 'success' : (aiResult.fixedNodes === null ? 'rejected' : 'failed');
        const fixDesc = fixApplied ? 'Fix applied successfully' : (aiResult.fixedNodes === null ? 'Error not fixable via node configuration' : 'No fix generated');

        await query(
            `UPDATE ai_fix_attempts SET status = $1, ai_diagnosis = $2, ai_fix_description = $3, fix_applied = $4, completed_at = NOW() WHERE id = $5`,
            [status, aiResult.diagnosis, fixDesc, fixApplied, attemptId]
        );

        return {
            status,
            diagnosis: aiResult.diagnosis,
            fixDescription: fixDesc,
            fixApplied,
            token_usage: aiResult.token_usage,
        };

    } catch (err: any) {
        // Update attempt as failed
        await query(
            `UPDATE ai_fix_attempts SET status = 'failed', ai_diagnosis = $1, completed_at = NOW() WHERE id = $2`,
            [err.message, attemptId]
        );
        throw err;
    }
}
