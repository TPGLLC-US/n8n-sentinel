import { startScheduler, stopScheduler } from './scheduler';

describe('scheduler', () => {
    afterEach(() => stopScheduler());

    it('starts and stops the heartbeat interval', () => {
        const interval = startScheduler({ heartbeatFn: () => Promise.resolve() });
        expect(interval).toBeDefined();
        stopScheduler();
        // Calling stop twice is a no-op
        expect(() => stopScheduler()).not.toThrow();
    });

    it('swallows heartbeat errors without throwing', async () => {
        const failing = () => Promise.reject(new Error('boom'));
        startScheduler({ heartbeatFn: failing, intervalMs: 10 });
        // Wait a tick so the interval fires once
        await new Promise(r => setTimeout(r, 30));
        stopScheduler();
        // If the error escaped, Jest would have failed on unhandled rejection.
        expect(true).toBe(true);
    });
});
