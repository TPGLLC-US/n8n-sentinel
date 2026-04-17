describe('encryption key validation', () => {
    const origEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...origEnv };
    });

    afterAll(() => {
        process.env = origEnv;
    });

    it('throws in production when ENCRYPTION_KEY is unset', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.ENCRYPTION_KEY;
        const { encrypt } = require('./encryption');
        expect(() => encrypt('hello')).toThrow(/ENCRYPTION_KEY/);
    });

    it('uses fallback in development and logs a warning', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.ENCRYPTION_KEY;
        process.env.SESSION_SECRET = 'x'.repeat(32);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const { encrypt, decrypt } = require('./encryption');
        const ct = encrypt('hello');
        expect(decrypt(ct)).toBe('hello');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('ENCRYPTION_KEY'));
        warn.mockRestore();
    });

    it('accepts a 64-char hex ENCRYPTION_KEY', () => {
        process.env.NODE_ENV = 'production';
        process.env.ENCRYPTION_KEY = 'a'.repeat(64);
        const { encrypt, decrypt } = require('./encryption');
        expect(decrypt(encrypt('roundtrip'))).toBe('roundtrip');
    });
});
