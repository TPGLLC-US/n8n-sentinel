import dns from 'dns/promises';
import { TIMEOUTS } from '../config/timeouts';

// ─── Blocked IP ranges ──────────────────────────────────────────────────

interface CIDRBlock {
    prefix: number[];
    bits: number;
}

const BLOCKED_CIDRS: CIDRBlock[] = [
    { prefix: [127, 0, 0, 0], bits: 8 },     // loopback
    { prefix: [10, 0, 0, 0], bits: 8 },      // RFC 1918
    { prefix: [172, 16, 0, 0], bits: 12 },   // RFC 1918
    { prefix: [192, 168, 0, 0], bits: 16 },  // RFC 1918
    { prefix: [169, 254, 0, 0], bits: 16 },  // link-local / cloud metadata
    { prefix: [0, 0, 0, 0], bits: 8 },       // "this" network
];

export function ipToInt(octets: number[]): number {
    return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

export function isBlockedIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;
    const ipInt = ipToInt(parts);
    for (const { prefix, bits } of BLOCKED_CIDRS) {
        const mask = (0xFFFFFFFF << (32 - bits)) >>> 0;
        if ((ipInt & mask) === (ipToInt(prefix) & mask)) return true;
    }
    return false;
}

export function isBlockedIPv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;  // fc00::/7
    if (lower.startsWith('fe80')) return true;                          // link-local
    // IPv4-mapped IPv6
    if (lower.startsWith('::ffff:')) {
        const v4part = lower.slice(7);
        if (v4part.includes('.')) return isBlockedIPv4(v4part);
    }
    return false;
}

export function isBlockedIP(ip: string): boolean {
    return ip.includes(':') ? isBlockedIPv6(ip) : isBlockedIPv4(ip);
}

// ─── Safe Fetch ─────────────────────────────────────────────────────────

export class SSRFError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SSRFError';
    }
}

export async function safeFetch(
    url: string,
    options: RequestInit = {},
    opts: { timeoutMs?: number; maxResponseBytes?: number; allowHttp?: boolean } = {}
): Promise<Response> {
    const { timeoutMs = TIMEOUTS.safeFetchDefault, allowHttp = false } = opts;

    // 1. Parse and validate URL
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new SSRFError(`Invalid URL: ${url}`);
    }

    // 2. Enforce HTTPS in production (unless explicitly allowed)
    if (!allowHttp && process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        throw new SSRFError('Only HTTPS URLs are allowed in production');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new SSRFError(`Blocked protocol: ${parsed.protocol}`);
    }

    // 3. Resolve hostname and check IP
    const hostname = parsed.hostname;
    // If hostname is already an IP, check directly
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        if (isBlockedIP(hostname)) {
            throw new SSRFError(`Blocked IP address: ${hostname}`);
        }
    } else {
        // Resolve DNS and check all IPs
        try {
            const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
            const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
            const allAddrs = [...addresses, ...addresses6];

            if (allAddrs.length === 0) {
                throw new SSRFError(`DNS resolution failed for: ${hostname}`);
            }

            for (const addr of allAddrs) {
                if (isBlockedIP(addr)) {
                    throw new SSRFError(`Hostname ${hostname} resolves to blocked IP: ${addr}`);
                }
            }
        } catch (err) {
            if (err instanceof SSRFError) throw err;
            throw new SSRFError(`DNS lookup failed for: ${hostname}`);
        }
    }

    // 4. Fetch with timeout
    const res = await globalThis.fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',  // don't follow redirects (could redirect to internal IP)
    });

    return res;
}
