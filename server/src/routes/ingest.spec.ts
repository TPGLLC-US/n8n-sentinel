import { nonceFormatIsValid } from './ingest';

describe('ingest nonce format', () => {
    it('rejects too-short nonces', () => {
        expect(nonceFormatIsValid('abc')).toBe(false);
    });
    it('accepts a 32-char alphanumeric nonce', () => {
        expect(nonceFormatIsValid('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6')).toBe(true);
    });
    it('rejects nonces with special characters', () => {
        expect(nonceFormatIsValid('abc def ghi jkl mno pqr stu vwxy')).toBe(false);
    });
});
