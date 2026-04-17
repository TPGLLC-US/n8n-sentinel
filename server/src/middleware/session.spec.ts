import { buildRefreshUserQuery } from './session';

describe('refresh endpoint user lookup', () => {
    it('only matches active users', () => {
        const sql = buildRefreshUserQuery();
        expect(sql).toMatch(/is_active\s*=\s*TRUE/i);
        expect(sql).toMatch(/WHERE\s+id\s*=\s*\$1/);
    });
});
