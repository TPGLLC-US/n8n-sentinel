import crypto from 'crypto';

/**
 * Generate a URL-safe random token for ingest paths.
 * Uses crypto.randomBytes for cryptographic randomness.
 * @param length Number of characters (default 24 for instance, 16 for account)
 */
export function generateIngestToken(length: number = 24): string {
    return crypto.randomBytes(Math.ceil(length * 0.75))
        .toString('base64url')
        .slice(0, length);
}
