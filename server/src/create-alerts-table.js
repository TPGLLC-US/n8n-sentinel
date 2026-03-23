
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://sentinel:password@localhost:5432/sentinel'
});

async function run() {
    try {
        await client.connect();
        console.log('Connected to database.');

        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS alerts (
                id SERIAL PRIMARY KEY,
                type VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                instance_id VARCHAR(255) REFERENCES instances(id),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                is_resolved BOOLEAN DEFAULT FALSE,
                resolved_at TIMESTAMP WITH TIME ZONE
            );
        `;

        console.log('Creating alerts table...');
        await client.query(createTableQuery);
        console.log('Alerts table created successfully.');

    } catch (err) {
        console.error('Error creating table:', err);
    } finally {
        await client.end();
    }
}

run();
