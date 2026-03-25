import { Request, Response, NextFunction } from 'express';
import { query } from '../db';
import {
    verifyPassword,
    generateAccessToken,
    verifyAccessToken,
    createRefreshToken,
    validateRefreshToken,
    revokeRefreshToken,
    TokenPayload,
} from '../lib/auth';

export interface AuthRequest extends Request {
    user?: TokenPayload;
}

// ─── Middleware: require valid access token ──────────────────────────────

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Malformed authorization header' });
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

// ─── POST /api/login ────────────────────────────────────────────────────

export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const result = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        const payload: TokenPayload = { userId: user.id, email: user.email, role: 'admin' };
        const accessToken = generateAccessToken(payload);
        const refreshToken = await createRefreshToken(user.id);

        res.json({ token: accessToken, refreshToken, user: { id: user.id, email: user.email } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ─── POST /api/auth/refresh ─────────────────────────────────────────────

export const refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token required' });
    }

    try {
        const valid = await validateRefreshToken(refreshToken);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        const result = await query('SELECT id, email FROM users WHERE id = $1', [valid.userId]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        const payload: TokenPayload = { userId: user.id, email: user.email, role: 'admin' };
        const accessToken = generateAccessToken(payload);

        res.json({ token: accessToken });
    } catch (error) {
        console.error('Refresh error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ─── POST /api/auth/logout ──────────────────────────────────────────────

export const logoutHandler = async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (refreshToken) {
        await revokeRefreshToken(refreshToken).catch(() => {});
    }
    res.json({ ok: true });
};
