function envMs(name: string, fallback: number): number {
    const v = process.env[name];
    if (!v) return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const TIMEOUTS = {
    safeFetchDefault: envMs('TIMEOUT_SAFE_FETCH_MS', 8_000),
    n8nApiRead:       envMs('TIMEOUT_N8N_READ_MS', 15_000),
    n8nApiExecution:  envMs('TIMEOUT_N8N_EXEC_READ_MS', 10_000),
} as const;
