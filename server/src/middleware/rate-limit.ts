import rateLimit from 'express-rate-limit';

// Login: 5 attempts per minute per IP
export const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts. Try again in 1 minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Diagnosis: 10 per minute (protects Anthropic API quota)
export const diagnosisLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Diagnosis rate limit exceeded. Try again shortly.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Refresh: 5 per minute per IP — blocks brute-forcing refresh tokens.
export const refreshLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many refresh attempts. Try again in 1 minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Logout: 10 per minute per IP — modest cap to avoid abuse of the revocation path.
export const logoutLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many logout attempts.' },
    standardHeaders: true,
    legacyHeaders: false,
});
