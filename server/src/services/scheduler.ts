import { checkHeartbeats } from './alerts';

let heartbeatInterval: NodeJS.Timeout | null = null;

export interface SchedulerOptions {
    heartbeatFn?: () => Promise<void>;
    intervalMs?: number;
}

export function startScheduler(opts: SchedulerOptions = {}): NodeJS.Timeout {
    const { heartbeatFn = checkHeartbeats, intervalMs = 60_000 } = opts;

    if (heartbeatInterval) return heartbeatInterval;

    heartbeatInterval = setInterval(() => {
        heartbeatFn().catch(err => {
            console.error('[scheduler] heartbeat error:', err);
        });
    }, intervalMs);

    return heartbeatInterval;
}

export function stopScheduler(): void {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}
