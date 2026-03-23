import { Request, Response, NextFunction } from 'express';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware factory: validates that req.params[paramName] is a valid UUID.
 * Returns 400 if not, preventing SQL injection via malformed IDs.
 */
export function validateUUID(paramName: string) {
    return (req: Request, res: Response, next: NextFunction) => {
        const value = req.params[paramName] as string;
        if (!value || !UUID_RE.test(value)) {
            return res.status(400).json({ error: `Invalid ${paramName} format` });
        }
        next();
    };
}
