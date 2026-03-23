
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
    connectionString: 'postgres://sentinel:password@localhost:5432/sentinel'
});

async function run() {
    try {
        await client.connect();
        console.log('Connected to database.');

        const schemaPath = path.join(__dirname, '..', '..', 'dbschema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Applying schema...');
        await client.query(schemaSql);
        console.log('Schema applied successfully.');

    } catch (err) {
        console.error('Error applying schema:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
