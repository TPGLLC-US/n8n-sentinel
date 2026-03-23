
const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://sentinel:password@localhost:5432/sentinel'
});

async function verify() {
    await client.connect();

    const counts = {};

    const wfs = await client.query('SELECT count(*) FROM workflows');
    counts.workflows = wfs.rows[0].count;

    const res = await client.query('SELECT count(*) FROM workflow_resources');
    counts.resources = res.rows[0].count;

    const execs = await client.query('SELECT count(*) FROM executions');
    counts.executions = execs.rows[0].count;

    const tokens = await client.query('SELECT count(*) FROM token_usage');
    counts.tokens = tokens.rows[0].count;

    console.log('--- Verification Results ---');
    console.table(counts);

    if (counts.workflows > 0 && counts.executions > 0) {
        console.log('SUCCESS: Data persisted correctly.');
    } else {
        console.log('FAILURE: Data missing.');
    }

    await client.end();
}

verify();
