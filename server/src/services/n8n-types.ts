// ─── n8n Workflow JSON Types ─────────────────────────────────────────────────
// Shared structural types for n8n workflow JSON consumed by workflow-utils and
// the AI fix/diagnosis services. These describe the shape of data returned by
// the n8n REST API; runtime validation is NOT performed — these types are a
// compile-time boundary only.

export interface N8nWorkflowNode {
    id?: string;
    name: string;
    type: string;
    typeVersion?: number;
    position?: [number, number];
    parameters?: Record<string, unknown>;
    credentials?: Record<string, { id: string; name: string }>;
    disabled?: boolean;
}

export interface N8nConnectionTarget {
    node: string;
    type: string;
    index: number;
}

export type N8nConnections = Record<string, {
    main?: N8nConnectionTarget[][];
    [key: string]: N8nConnectionTarget[][] | undefined;
}>;

export interface N8nWorkflow {
    id?: string;
    name?: string;
    nodes: N8nWorkflowNode[];
    connections: N8nConnections;
    settings?: Record<string, unknown>;
    staticData?: Record<string, unknown> | null;
}
