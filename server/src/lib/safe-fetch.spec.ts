import { isBlockedIPv4, isBlockedIPv6, isBlockedIP } from './safe-fetch';

describe('safe-fetch IP blocklist', () => {
    describe('isBlockedIPv4', () => {
        it('blocks loopback', () => {
            expect(isBlockedIPv4('127.0.0.1')).toBe(true);
            expect(isBlockedIPv4('127.255.255.254')).toBe(true);
        });
        it('blocks RFC 1918 ranges', () => {
            expect(isBlockedIPv4('10.0.0.1')).toBe(true);
            expect(isBlockedIPv4('172.16.0.1')).toBe(true);
            expect(isBlockedIPv4('172.31.255.254')).toBe(true);
            expect(isBlockedIPv4('192.168.1.1')).toBe(true);
        });
        it('blocks link-local (cloud metadata)', () => {
            expect(isBlockedIPv4('169.254.169.254')).toBe(true);
        });
        it('allows public addresses', () => {
            expect(isBlockedIPv4('8.8.8.8')).toBe(false);
            expect(isBlockedIPv4('172.15.255.255')).toBe(false);
            expect(isBlockedIPv4('172.32.0.1')).toBe(false);
        });
        it('rejects malformed addresses', () => {
            expect(isBlockedIPv4('not an ip')).toBe(true);
            expect(isBlockedIPv4('1.2.3')).toBe(true);
            expect(isBlockedIPv4('999.1.1.1')).toBe(true);
        });
    });

    describe('isBlockedIPv6', () => {
        it('blocks loopback', () => {
            expect(isBlockedIPv6('::1')).toBe(true);
        });
        it('blocks ULA range fc00::/7', () => {
            expect(isBlockedIPv6('fc00::1')).toBe(true);
            expect(isBlockedIPv6('fd12:3456:789a::1')).toBe(true);
        });
        it('blocks link-local fe80::/10', () => {
            expect(isBlockedIPv6('fe80::1')).toBe(true);
        });
        it('blocks IPv4-mapped private addresses', () => {
            expect(isBlockedIPv6('::ffff:10.0.0.1')).toBe(true);
            expect(isBlockedIPv6('::ffff:192.168.1.1')).toBe(true);
        });
        it('allows public IPv6', () => {
            expect(isBlockedIPv6('2606:4700:4700::1111')).toBe(false);
        });
    });

    describe('isBlockedIP dispatch', () => {
        it('routes v4 vs v6 correctly', () => {
            expect(isBlockedIP('127.0.0.1')).toBe(true);
            expect(isBlockedIP('::1')).toBe(true);
            expect(isBlockedIP('8.8.8.8')).toBe(false);
        });
    });
});
