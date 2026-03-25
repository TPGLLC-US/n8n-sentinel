import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config(); // try CWD/.env
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') }); // fallback: monorepo root

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEV_DATABASE_URL = 'postgres://sentinel:password@localhost:5432/sentinel';

if (IS_PRODUCTION && !process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL is required in production.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEV_DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
export const getClient = () => pool.connect();

export const checkDatabaseHealth = async () => {
    try {
        const res = await pool.query('SELECT NOW()');
        return true;
    } catch (error) {
        console.error('Database health check failed:', error);
        return false;
    }
};
