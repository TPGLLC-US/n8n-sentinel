import { authFetch } from './auth';

export const fetchInstances = async () => {
    const res = await authFetch('/instances');
    if (!res.ok) throw new Error('Failed to fetch instances');
    return res.json();
};

export class VerifyError extends Error {
    details?: string;
    suggestions?: string[];
    constructor(data: { error: string; details?: string; suggestions?: string[] }) {
        super(data.error);
        this.details = data.details;
        this.suggestions = data.suggestions;
    }
}

export const verifyN8nUrl = async (url: string, api_key?: string) => {
    const res = await authFetch('/instances/verify-n8n', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, api_key: api_key || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new VerifyError(data);
    return data as { verified: boolean; url: string; verify_method: string; workflow_count: number | null; execution_count: number | null };
};

export const updateInstance = async (id: string, params: { name?: string; environment?: string; base_url?: string }) => {
    const res = await authFetch(`/instances/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update instance');
    }
    return res.json();
};

export const deleteInstance = async (id: string) => {
    const res = await authFetch(`/instances/${id}`, { method: 'DELETE' });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete instance');
    }
    return res.json();
};

export const toggleInstance = async (id: string) => {
    const res = await authFetch(`/instances/${id}/toggle`, { method: 'PATCH' });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to toggle instance');
    }
    return res.json();
};

export const rotateSecret = async (id: string) => {
    const res = await authFetch(`/instances/${id}/rotate-secret`, { method: 'POST' });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to rotate secret');
    }
    return res.json();
};

export const registerInstance = async (params: {
    name: string;
    environment: string;
    base_url?: string;
    baseline_workflow_count?: number | null;
    baseline_execution_count?: number | null;
}) => {
    const res = await authFetch('/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to register instance');
    }
    return res.json();
};
