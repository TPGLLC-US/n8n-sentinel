import { query } from '../db';
import format from 'pg-format';
import { extractResources, extractTokenUsage } from './extractor';
import { ensureModelsLoaded, lookupModel } from './models';

interface WorkflowData {
    remote_id: string;
    name: string;
    is_active: boolean;
    node_count: number;
    created_at?: string;
    updated_at?: string;
    nodes?: any[]; // Raw nodes for extraction
}

interface ResourceData {
    type: string;
    identifier: string;
    provider?: string;
    node_name?: string;
}

interface PreExtractedToken {
    model: string;
    provider?: string;
    tokens_input: number;
    tokens_output: number;
    node_name?: string;
}

interface ExecutionData {
    remote_execution_id: string;
    workflow_remote_id: string;
    status: string;
    started_at: string;
    finished_at?: string;
    duration_ms?: number;
    error_message?: string;
    error_node?: string;
    token_usage?: PreExtractedToken[]; // Pre-extracted by reporter workflow
    data?: any; // Legacy: raw execution data for server-side extraction
}

interface TokenUsageData {
    model: string;
    provider: string;
    tokens_input: number;
    tokens_output: number;
    accuracy: string;
}

export const processConfiguration = async (instanceId: string, data: { workflows: any[] }) => {
    const { workflows } = data;
    if (!workflows || !Array.isArray(workflows)) return;

    // Ensure models.dev cache is loaded before extracting resources
    await ensureModelsLoaded();

    // 1. Normalize all workflows and extract resources upfront
    const normalized: { wf: WorkflowData; resources: ResourceData[] }[] = [];
    for (const raw of workflows) {
        const wf: WorkflowData = {
            remote_id: raw.remote_id || raw.id,
            name: raw.name,
            is_active: raw.is_active ?? raw.active ?? false,
            node_count: raw.node_count ?? (raw.nodes || []).length,
            created_at: raw.created_at || raw.createdAt,
            updated_at: raw.updated_at || raw.updatedAt,
            nodes: raw.nodes,
        };
        if (!wf.remote_id) continue;

        const resources = wf.nodes && Array.isArray(wf.nodes)
            ? extractResources(wf)
            : (raw.resources || []);

        normalized.push({ wf, resources });
    }

    if (normalized.length === 0) return;

    // 2. Bulk upsert workflows
    const wfValues = normalized.map(({ wf }) => [
        instanceId,
        wf.remote_id,
        wf.name,
        wf.is_active,
        wf.node_count,
        wf.created_at || null,
        wf.updated_at || null,
        new Date(),
    ]);

    const wfResult = await query(format(
        `INSERT INTO workflows (instance_id, remote_id, name, is_active, node_count, remote_created_at, remote_updated_at, last_synced_at)
         VALUES %L
         ON CONFLICT (instance_id, remote_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           is_active = EXCLUDED.is_active,
           node_count = EXCLUDED.node_count,
           remote_updated_at = EXCLUDED.remote_updated_at,
           last_synced_at = NOW()
         RETURNING id, remote_id`,
        wfValues
    ));

    // Map remote_id → internal workflow UUID
    const wfIdMap = new Map<string, string>();
    wfResult.rows.forEach((row: any) => wfIdMap.set(row.remote_id, row.id));

    // 3. Bulk upsert resources
    const resValues: any[] = [];
    for (const { wf, resources } of normalized) {
        const workflowId = wfIdMap.get(String(wf.remote_id));
        if (!workflowId) continue;
        for (const res of resources) {
            resValues.push([
                workflowId,
                res.type,
                res.identifier,
                res.provider || null,
                (res as any).node_name || null,
                (res as any).credential_name || null,
                (res as any).credential_id || null,
                (res as any).credential_exposed || false,
                new Date(),
            ]);
        }
    }

    // Deduplicate by conflict key (workflow_id, resource_type, resource_identifier)
    // A workflow can reference the same resource from multiple nodes
    const resDeduped = [...new Map(resValues.map(r => [`${r[0]}|${r[1]}|${r[2]}`, r])).values()];

    if (resDeduped.length > 0) {
        await query(format(
            `INSERT INTO workflow_resources (workflow_id, resource_type, resource_identifier, provider, node_name, credential_name, credential_id, credential_exposed, last_seen_at)
             VALUES %L
             ON CONFLICT (workflow_id, resource_type, resource_identifier)
             DO UPDATE SET last_seen_at = NOW(), node_name = EXCLUDED.node_name, provider = EXCLUDED.provider,
               credential_name = EXCLUDED.credential_name, credential_id = EXCLUDED.credential_id,
               credential_exposed = EXCLUDED.credential_exposed`,
            resDeduped
        ));
    }
};

export const processExecutions = async (instanceId: string, data: { executions: any[] }) => {
    const { executions } = data;
    if (!executions || executions.length === 0) return;

    // Normalize: handle both raw n8n API format and reporter-transformed format
    // n8n API execution objects may use workflowId, workflowData.id, or workflow.id
    const normalized: ExecutionData[] = executions.map(raw => {
        const startedAt = raw.started_at || raw.startedAt;
        const finishedAt = raw.finished_at || raw.stoppedAt || raw.finishedAt;
        const durationMs = raw.duration_ms ??
            (startedAt && finishedAt ? new Date(finishedAt).getTime() - new Date(startedAt).getTime() : null);

        const execId = raw.remote_execution_id || raw.id;
        const wfId = raw.workflow_remote_id || raw.workflowId || raw.workflowData?.id || raw.workflow?.id;

        return {
            remote_execution_id: execId != null ? String(execId) : '',
            workflow_remote_id: wfId != null ? String(wfId) : '',
            status: raw.status || (raw.finished ? 'success' : (raw.stoppedAt ? 'error' : 'running')),
            started_at: startedAt,
            finished_at: finishedAt,
            duration_ms: durationMs != null ? Math.max(0, durationMs) : undefined,
            error_message: raw.error_message || undefined,
            error_node: raw.error_node || raw.lastNodeExecuted || undefined,
            token_usage: raw.token_usage || undefined,
            data: raw.data,
        };
    }).filter(e => e.remote_execution_id && e.workflow_remote_id);

    if (normalized.length === 0) {
        console.warn(`[ingest] All ${executions.length} executions filtered out during normalization (missing id or workflowId)`);
        return;
    }

    const errorExecs = normalized.filter(e => e.status === 'error');
    const ids = normalized.map(e => parseInt(e.remote_execution_id)).filter(n => !isNaN(n));
    const newest = ids.length ? Math.max(...ids) : '?';
    const oldest = ids.length ? Math.min(...ids) : '?';
    console.log(`[ingest] Processing ${normalized.length} executions (${errorExecs.length} errors) for instance ${instanceId} | IDs: ${oldest}..${newest}`);

    // 1. Find Workflow IDs in bulk
    const remoteWorkflowIds = [...new Set(normalized.map(e => e.workflow_remote_id))];
    const wfRes = await query(
        'SELECT id, remote_id FROM workflows WHERE instance_id = $1 AND remote_id = ANY($2)',
        [instanceId, remoteWorkflowIds]
    );

    const wfMap = new Map();
    wfRes.rows.forEach(row => wfMap.set(row.remote_id, row.id));

    const missingWfs = remoteWorkflowIds.filter(id => !wfMap.has(id));
    if (missingWfs.length > 0) {
        console.warn(`[ingest] ${missingWfs.length} workflows not found in DB: ${missingWfs.join(', ')} — their executions will be skipped`);
    }

    // 2. Prepare bulk execution data
    const executionValues: any[] = [];
    const validExecutions: any[] = [];

    for (const exec of normalized) {
        const workflowId = wfMap.get(exec.workflow_remote_id);
        if (!workflowId) {
            continue;
        }

        executionValues.push([
            workflowId,
            exec.remote_execution_id,
            exec.status,
            exec.started_at,
            exec.finished_at || null,
            exec.duration_ms || null,
            exec.error_message || null,
            exec.error_node || null
        ]);
        validExecutions.push({ ...exec, workflowId });
    }

    if (executionValues.length === 0) return;

    // 3. Bulk Upsert Executions
    const execInsertQuery = format(
        `INSERT INTO executions (workflow_id, remote_execution_id, status, started_at, finished_at, duration_ms, error_message, error_node)
         VALUES %L
         ON CONFLICT (workflow_id, remote_execution_id)
         DO UPDATE SET
           status = EXCLUDED.status,
           finished_at = EXCLUDED.finished_at,
           duration_ms = EXCLUDED.duration_ms,
           error_message = COALESCE(EXCLUDED.error_message, executions.error_message),
           error_node = COALESCE(EXCLUDED.error_node, executions.error_node)
         RETURNING id, remote_execution_id`,
        executionValues
    );

    const execResult = await query(execInsertQuery);

    // Map remote_execution_id to internal execution id
    const execIdMap = new Map();
    execResult.rows.forEach(row => execIdMap.set(row.remote_execution_id, row.id));

    // 4. Prepare Bulk Token Usage Data
    const tokenValues: any[] = [];
    const executionIdsToClear: number[] = [];

    for (const exec of validExecutions) {
        const executionId = execIdMap.get(exec.remote_execution_id);
        if (!executionId) continue;

        // Prefer pre-extracted token_usage from reporter, fall back to server-side extraction
        const tokenUsage = exec.token_usage && exec.token_usage.length > 0
            ? exec.token_usage
            : extractTokenUsage(exec);
        if (tokenUsage.length > 0) {
            executionIdsToClear.push(executionId);
            for (const usage of tokenUsage) {
                // Resolve provider from model name if not already set
                let provider = usage.provider || 'unknown';
                if (provider === 'unknown' && usage.model && usage.model !== 'unknown') {
                    const match = lookupModel(usage.model);
                    if (match) provider = match.providerId;
                }
                tokenValues.push([
                    executionId,
                    usage.model || 'unknown',
                    provider,
                    usage.tokens_input || 0,
                    usage.tokens_output || 0,
                    (usage as any).accuracy || 'exact'
                ]);
            }
        }
    }

    if (executionIdsToClear.length > 0) {
        await query(
            'DELETE FROM token_usage WHERE execution_id = ANY($1)',
            [executionIdsToClear]
        );
    }

    if (tokenValues.length > 0) {
        const tokenInsertQuery = format(
            `INSERT INTO token_usage (execution_id, model, provider, tokens_input, tokens_output, accuracy)
             VALUES %L`,
            tokenValues
        );
        await query(tokenInsertQuery);
    }
};
