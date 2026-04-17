import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let _warnedAboutFallback = false;

function getEncryptionKey(): Buffer {
    let key = process.env.ENCRYPTION_KEY;

    if (!key) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('ENCRYPTION_KEY is required in production. Set it to a 32-byte hex string.');
        }
        const fallbackSeed = process.env.SESSION_SECRET || 'n8n-sentinel-dev-encryption-seed';
        key = crypto.createHash('sha256').update(fallbackSeed).digest('hex');
        if (!_warnedAboutFallback) {
            console.warn('[encryption] ENCRYPTION_KEY not set — using dev fallback derived from SESSION_SECRET. Set ENCRYPTION_KEY in production!');
            _warnedAboutFallback = true;
        }
    }

    if (key.length === 64 && /^[0-9a-f]+$/i.test(key)) {
        return Buffer.from(key, 'hex');
    }
    return crypto.createHash('sha256').update(key).digest();
}

export function encrypt(plaintext: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Format: iv:authTag:ciphertext (all base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(encoded: string): string {
    const key = getEncryptionKey();
    const parts = encoded.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted value format');
    }
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
}
