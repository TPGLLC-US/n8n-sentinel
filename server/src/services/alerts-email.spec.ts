import { recordEmailFailure } from './alerts';

describe('alerts email failure recording', () => {
    it('returns an INSERT SQL string with the expected columns', () => {
        const { sql, values } = recordEmailFailure.buildQuery({
            alertType: 't', severity: 'warning', message: 'm', instanceId: 'i',
            triggeredAt: new Date('2026-04-17T00:00:00Z'), errorMessage: 'oops',
        });
        expect(sql).toMatch(/INSERT INTO alert_email_attempts/);
        expect(values).toEqual(['t', 'warning', 'm', 'i', expect.any(Date), 'failed', 'oops']);
    });
});
