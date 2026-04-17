import { createAlertInsertQuery } from './alerts';

describe('alerts INSERT dedupe', () => {
    it('uses ON CONFLICT DO NOTHING against the partial unique index', () => {
        const sql = createAlertInsertQuery();
        expect(sql).toMatch(/ON CONFLICT DO NOTHING/i);
    });
});
