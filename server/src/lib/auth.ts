import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db';

// ─── Startup Validation ─────────────────────────────────────────────────

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEV_SESSION_SECRET = 'dev-only-secret-do-not-use-in-production-min32chars!!';

function getRequiredEnv(name: string, devDefault?: string): string {
    const val = process.env[name];
    if (!val) {
        if (!IS_PRODUCTION && devDefault) {
            console.warn(`[auth] ${name} not set — using dev default (NOT safe for production)`);
            return devDefault;
        }
        console.error(`FATAL: Required environment variable ${name} is not set.`);
        process.exit(1);
    }
    return val;
}

export function getSessionSecret(): string {
    const secret = getRequiredEnv('SESSION_SECRET', DEV_SESSION_SECRET);
    if (IS_PRODUCTION && (secret === DEV_SESSION_SECRET || secret.length < 32)) {
        console.error('FATAL: SESSION_SECRET must be at least 32 characters and not the default value.');
        process.exit(1);
    }
    return secret;
}

// ─── Password Hashing ───────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

// ─── User Seeding ───────────────────────────────────────────────────────

export async function seedAdminUser(): Promise<void> {
    const email = getRequiredEnv('SENTINEL_ADMIN_EMAIL', 'admin@sentinel.local');
    const password = getRequiredEnv('SENTINEL_ADMIN_PASSWORD', 'admin1234admin');

    if (IS_PRODUCTION && password.length < 12) {
        console.error('FATAL: SENTINEL_ADMIN_PASSWORD must be at least 12 characters.');
        process.exit(1);
    }

    const passwordHash = await hashPassword(password);

    // Upsert: create user or update password if email already exists
    const result = await query(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET password_hash = $2
         RETURNING (xmax = 0) AS inserted`,
        [email, passwordHash]
    );
    const wasInserted = result.rows[0]?.inserted;
    console.log(`[auth] Admin user ${email} ${wasInserted ? 'created' : 'password updated'}.`);
}

// ─── JWT Tokens ─────────────────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export interface TokenPayload {
    userId: string;
    email: string;
    role: string;
}

export function generateAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, getSessionSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string): TokenPayload {
    return jwt.verify(token, getSessionSecret()) as TokenPayload;
}

// ─── Refresh Tokens ─────────────────────────────────────────────────────

export async function createRefreshToken(userId: string): Promise<string> {
    const token = crypto.randomBytes(48).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [userId, tokenHash, expiresAt]
    );

    return token;
}

export async function validateRefreshToken(token: string): Promise<{ userId: string } | null> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await query(
        'SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()',
        [tokenHash]
    );
    if (result.rows.length === 0) return null;
    return { userId: result.rows[0].user_id };
}

export async function revokeRefreshToken(token: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

// ─── Cleanup expired refresh tokens (called by data-retention) ──────────

export async function cleanExpiredRefreshTokens(): Promise<void> {
    await query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
}
