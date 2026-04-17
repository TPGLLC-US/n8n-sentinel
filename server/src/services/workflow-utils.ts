// ─── Workflow & Execution JSON Utilities ─────────────────────────────────────
// Pure functions for extracting, replacing, and mapping n8n workflow/execution data.
// Used by the agentic AI diagnosis and fix loops.

import { N8nWorkflow, N8nWorkflowNode, N8nConnections, N8nConnectionTarget } from './n8n-types';

// ─── Workflow JSON utilities ─────────────────────────────────────────────────

/**
 * Extract specific nodes by name from a workflow's nodes array.
 * Returns found nodes and a list of names that weren't found.
 */
export function extractNodesFromWorkflow(
    workflowJson: N8nWorkflow,
    nodeNames: string[]
): { nodes: N8nWorkflowNode[]; notFound: string[] } {
    const nodes: N8nWorkflowNode[] = [];
    const notFound: string[] = [];
    const allNodes: N8nWorkflowNode[] = workflowJson?.nodes || [];

    for (const name of nodeNames) {
        const node = allNodes.find((n: N8nWorkflowNode) => n.name === name);
        if (node) {
            nodes.push(node);
        } else {
            notFound.push(name);
        }
    }

    return { nodes, notFound };
}

/**
 * Extract nodes + their relevant connections subgraph.
 * Returns only connections where both source and target are in the requested set.
 */
export function extractNodesWithConnections(
    workflowJson: N8nWorkflow,
    nodeNames: string[]
): { nodes: N8nWorkflowNode[]; connections: N8nConnections } {
    const { nodes } = extractNodesFromWorkflow(workflowJson, nodeNames);
    const nameSet = new Set(nodeNames);
    const connections: N8nConnections = {};
    const allConnections: N8nConnections = workflowJson?.connections || {};

    for (const sourceName of Object.keys(allConnections)) {
        if (!nameSet.has(sourceName)) continue;

        const sourceConns = allConnections[sourceName];
        const filteredSource: N8nConnections[string] = {};

        for (const connType of Object.keys(sourceConns)) {
            const outputs: N8nConnectionTarget[][] = sourceConns[connType] || [];
            const filteredOutputs = outputs.map((outputGroup: N8nConnectionTarget[]) =>
                outputGroup.filter((conn: N8nConnectionTarget) => nameSet.has(conn.node))
            );
            // Only include if there are actual connections
            if (filteredOutputs.some((g: N8nConnectionTarget[]) => g.length > 0)) {
                filteredSource[connType] = filteredOutputs;
            }
        }

        if (Object.keys(filteredSource).length > 0) {
            connections[sourceName] = filteredSource;
        }
    }

    return { nodes, connections };
}

/**
 * Replace/update specific nodes in a workflow's nodes array (by name match).
 * Returns the full updated workflowJson (shallow clone with new nodes array).
 */
export function replaceNodesInWorkflow(workflowJson: N8nWorkflow, updatedNodes: N8nWorkflowNode[]): N8nWorkflow {
    const updateMap = new Map<string, N8nWorkflowNode>();
    for (const node of updatedNodes) {
        if (node.name) {
            updateMap.set(node.name, node);
        }
    }

    const newNodes = (workflowJson?.nodes || []).map((existing: N8nWorkflowNode) => {
        const replacement = updateMap.get(existing.name);
        return replacement || existing;
    });

    return { ...workflowJson, nodes: newNodes };
}

/**
 * Get connected nodes N hops from a given node (upstream, downstream, or both).
 * Returns an array of unique node names (excluding the starting node).
 */
export function getConnectedNodes(
    workflowJson: N8nWorkflow,
    nodeName: string,
    direction: 'upstream' | 'downstream' | 'both' = 'both',
    hops: number = 1
): string[] {
    const connections: N8nConnections = workflowJson?.connections || {};
    const results = new Set<string>();

    if (direction === 'downstream' || direction === 'both') {
        collectDownstream(connections, nodeName, hops, results);
    }

    if (direction === 'upstream' || direction === 'both') {
        // Build reverse adjacency for upstream traversal
        const reverseMap = buildReverseMap(connections);
        collectFromMap(reverseMap, nodeName, hops, results);
    }

    results.delete(nodeName);
    return Array.from(results);
}

/** Collect downstream nodes via BFS up to N hops */
function collectDownstream(
    connections: N8nConnections,
    startNode: string,
    hops: number,
    results: Set<string>
): void {
    const forwardMap = buildForwardMap(connections);
    collectFromMap(forwardMap, startNode, hops, results);
}

/** Build a forward adjacency map: source → [target1, target2, ...] */
function buildForwardMap(connections: N8nConnections): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const sourceName of Object.keys(connections)) {
        const targets: string[] = [];
        const sourceConns = connections[sourceName];

        for (const connType of Object.keys(sourceConns)) {
            const outputs: N8nConnectionTarget[][] = sourceConns[connType] || [];
            for (const outputGroup of outputs) {
                for (const conn of outputGroup) {
                    if (conn.node) {
                        targets.push(conn.node);
                    }
                }
            }
        }

        if (targets.length > 0) {
            map.set(sourceName, targets);
        }
    }

    return map;
}

/** Build a reverse adjacency map: target → [source1, source2, ...] */
function buildReverseMap(connections: N8nConnections): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const sourceName of Object.keys(connections)) {
        const sourceConns = connections[sourceName];

        for (const connType of Object.keys(sourceConns)) {
            const outputs: N8nConnectionTarget[][] = sourceConns[connType] || [];
            for (const outputGroup of outputs) {
                for (const conn of outputGroup) {
                    if (conn.node) {
                        const existing = map.get(conn.node) || [];
                        existing.push(sourceName);
                        map.set(conn.node, existing);
                    }
                }
            }
        }
    }

    return map;
}

/** BFS traversal from startNode up to N hops, collecting visited node names */
function collectFromMap(
    adjacency: Map<string, string[]>,
    startNode: string,
    hops: number,
    results: Set<string>
): void {
    let frontier = [startNode];

    for (let hop = 0; hop < hops; hop++) {
        const nextFrontier: string[] = [];
        for (const node of frontier) {
            const neighbors = adjacency.get(node) || [];
            for (const neighbor of neighbors) {
                if (!results.has(neighbor) && neighbor !== startNode) {
                    results.add(neighbor);
                    nextFrontier.push(neighbor);
                }
            }
        }
        frontier = nextFrontier;
        if (frontier.length === 0) break;
    }
}

/**
 * Build a lightweight textual map of the workflow.
 * Shows node names, types, connections, and annotates the error node.
 * Includes total node count and estimated token cost for the full JSON.
 */
export function getWorkflowMap(workflowJson: N8nWorkflow, errorNode?: string): string {
    const nodes: N8nWorkflowNode[] = workflowJson?.nodes || [];
    const connections: N8nConnections = workflowJson?.connections || {};
    const forwardMap = buildForwardMap(connections);
    const estTokens = estimateTokens(workflowJson);

    const lines: string[] = [
        `WORKFLOW MAP (${nodes.length} nodes, ~${estTokens.toLocaleString()} est. tokens for full JSON):`,
    ];

    // Build a set of nodes that have incoming connections (are targets)
    const hasIncoming = new Set<string>();
    forwardMap.forEach((targets) => {
        for (const t of targets) {
            hasIncoming.add(t);
        }
    });

    // Start with trigger/root nodes (no incoming connections), then list the rest
    const rootNodes = nodes.filter((n: N8nWorkflowNode) => !hasIncoming.has(n.name));
    const nonRootNodes = nodes.filter((n: N8nWorkflowNode) => hasIncoming.has(n.name));
    const orderedNodes = [...rootNodes, ...nonRootNodes];

    for (const node of orderedNodes) {
        const name = node.name || 'Unknown';
        const type = node.type || 'unknown';
        const isError = errorNode && name === errorNode;
        const errorMarker = isError ? ' ⚠️ ERRORED' : '';
        const targets = forwardMap.get(name) || [];
        const arrow = targets.length > 0 ? ` → ${targets.join(', ')}` : '';

        lines.push(`  ${name} [${type}]${errorMarker}${arrow}`);
    }

    return lines.join('\n');
}

/**
 * Strip large non-essential fields from n8n workflow JSON before sending to AI.
 * Removes staticData (polling state, can be megabytes) and pinData (test data).
 */
export function sanitizeWorkflowForAI(workflowJson: N8nWorkflow): N8nWorkflow {
    if (!workflowJson || typeof workflowJson !== 'object') return workflowJson;
    const { staticData, pinData, ...clean } = workflowJson as N8nWorkflow & { pinData?: unknown };
    return clean as N8nWorkflow;
}

/**
 * Estimate token count for a JSON object.
 * Uses ~4 characters per token as a rough heuristic.
 */
export function estimateTokens(json: unknown): number {
    try {
        const str = JSON.stringify(json);
        return Math.ceil(str.length / 4);
    } catch {
        return 0;
    }
}

// ─── Execution JSON utilities ────────────────────────────────────────────────

/**
 * Extract runtime input/output data for specific nodes from execution data.
 * n8n execution data structure: data.resultData.runData[nodeName][runIndex].data
 *
 * Each run has: { startTime, executionTime, source, data: { main: [[{json, binary?}]] } }
 */
export function extractNodeResultsFromExecution(
    executionData: any, // n8n execution JSON — not typed in this boundary
    nodeNames: string[]
): Record<string, { input: any[]; output: any[]; error?: any }> {
    const results: Record<string, { input: any[]; output: any[]; error?: any }> = {};
    const runData = executionData?.data?.resultData?.runData || {};

    for (const name of nodeNames) {
        const runs = runData[name];
        if (!runs || !Array.isArray(runs) || runs.length === 0) {
            results[name] = { input: [], output: [], error: undefined };
            continue;
        }

        // Take the last run (most recent attempt)
        const lastRun = runs[runs.length - 1];

        // Output data from the run
        const outputData = lastRun.data?.main?.[0] || [];
        const output = outputData.map((item: any) => item?.json || item).slice(0, 5); // Limit to 5 items

        // Input data: comes from source connections' output data
        // n8n stores it in the run's source array
        const inputData: any[] = [];
        if (lastRun.source && Array.isArray(lastRun.source)) {
            for (const sourceGroup of lastRun.source) {
                if (Array.isArray(sourceGroup)) {
                    for (const src of sourceGroup) {
                        if (src?.previousNode) {
                            const srcRuns = runData[src.previousNode];
                            if (srcRuns && srcRuns.length > 0) {
                                const srcLastRun = srcRuns[srcRuns.length - 1];
                                const srcOutput = srcLastRun.data?.main?.[0] || [];
                                inputData.push(...srcOutput.map((item: any) => item?.json || item).slice(0, 5));
                            }
                        }
                    }
                }
            }
        }

        // Error data if present
        const error = lastRun.error || undefined;

        results[name] = {
            input: inputData.slice(0, 5), // Limit total input items
            output,
            error: error ? { message: error.message, description: error.description, stack: error.stack?.split('\n').slice(0, 3).join('\n') } : undefined,
        };
    }

    return results;
}

/**
 * Extract error metadata from execution data.
 */
// ─── Fix Validation ─────────────────────────────────────────────────────────

export interface FixValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validate proposed fixed nodes against the original workflow.
 * Checks:
 * - Fixed node names exist in the original workflow
 * - Credentials references are preserved (not accidentally stripped)
 * - Expression references (e.g., $('NodeName')) point to nodes that exist
 * - Node type hasn't changed (likely a mistake)
 * - Required fields (name, type) are present
 */
export function validateFixedNodes(
    workflowJson: N8nWorkflow,
    fixedNodes: N8nWorkflowNode[]
): FixValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const allNodes: N8nWorkflowNode[] = workflowJson?.nodes || [];
    const allNodeNames = new Set(allNodes.map((n: N8nWorkflowNode) => n.name));
    const originalByName = new Map<string, N8nWorkflowNode>(allNodes.map((n: N8nWorkflowNode) => [n.name, n]));

    for (const fixedNode of fixedNodes) {
        // Basic structure checks
        if (!fixedNode.name) {
            errors.push('Fixed node is missing a "name" field');
            continue;
        }
        if (!fixedNode.type) {
            errors.push(`Node "${fixedNode.name}": missing "type" field`);
        }

        const original = originalByName.get(fixedNode.name);

        // Check node exists in workflow
        if (!original) {
            errors.push(`Node "${fixedNode.name}" does not exist in the workflow. Available nodes: ${Array.from(allNodeNames).slice(0, 10).join(', ')}${allNodeNames.size > 10 ? '...' : ''}`);
            continue;
        }

        // Check type hasn't changed
        if (fixedNode.type && original.type && fixedNode.type !== original.type) {
            warnings.push(`Node "${fixedNode.name}": type changed from "${original.type}" to "${fixedNode.type}" — this is usually a mistake`);
        }

        // Check credentials preserved
        if (original.credentials && Object.keys(original.credentials).length > 0) {
            if (!fixedNode.credentials || Object.keys(fixedNode.credentials).length === 0) {
                errors.push(`Node "${fixedNode.name}": credentials were stripped! Original had: ${Object.keys(original.credentials).join(', ')}`);
            } else {
                // Check each credential key is still present
                for (const credKey of Object.keys(original.credentials)) {
                    if (!fixedNode.credentials[credKey]) {
                        errors.push(`Node "${fixedNode.name}": credential "${credKey}" was removed`);
                    }
                }
            }
        }

        // Check ID preserved
        if (original.id && fixedNode.id && original.id !== fixedNode.id) {
            warnings.push(`Node "${fixedNode.name}": node ID changed from "${original.id}" to "${fixedNode.id}"`);
        }

        // Check position preserved
        if (original.position && fixedNode.position) {
            const [ox, oy] = original.position;
            const [fx, fy] = fixedNode.position;
            if (Math.abs(ox - fx) > 50 || Math.abs(oy - fy) > 50) {
                warnings.push(`Node "${fixedNode.name}": position moved significantly from [${ox},${oy}] to [${fx},${fy}]`);
            }
        }

        // Check expression references point to existing nodes
        const nodeJson = JSON.stringify(fixedNode);
        const exprRefs = nodeJson.matchAll(/\$\(['"]([^'"]+)['"]\)/g);
        for (const match of exprRefs) {
            const refName = match[1];
            if (!allNodeNames.has(refName)) {
                errors.push(`Node "${fixedNode.name}": expression references node "${refName}" which does not exist in the workflow`);
            }
        }

        // Check for common expression syntax issues
        const brokenExprs = nodeJson.matchAll(/\{\{([^}]*)\}\}/g);
        for (const match of brokenExprs) {
            const expr = match[1];
            // Check balanced parentheses
            let depth = 0;
            for (const char of expr) {
                if (char === '(') depth++;
                if (char === ')') depth--;
                if (depth < 0) break;
            }
            if (depth !== 0) {
                warnings.push(`Node "${fixedNode.name}": expression has unbalanced parentheses: {{ ${expr.slice(0, 60)}${expr.length > 60 ? '...' : ''} }}`);
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

export function getExecutionErrorContext(executionData: any): {
    errorMessage: string;
    errorNode: string;
    startedAt: string;
    stoppedAt: string;
    mode: string;
    executionId: string;
} {
    const resultData = executionData?.data?.resultData || {};
    const error = resultData.error || {};

    return {
        errorMessage: error.message || error.description || 'Unknown error',
        errorNode: resultData.lastNodeExecuted || executionData?.lastNodeExecuted || 'Unknown',
        startedAt: executionData?.startedAt || '',
        stoppedAt: executionData?.stoppedAt || '',
        mode: executionData?.mode || 'unknown',
        executionId: executionData?.id?.toString() || '',
    };
}
