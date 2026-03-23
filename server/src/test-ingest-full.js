
const crypto = require('crypto');
const http = require('http');

const INSTANCE_ID = '8a5f775b-1750-4c4a-a1d3-29a2bd561553'; // Use the ID from your DB
const HMAC_SECRET = 'mAl2jsyUH6U7xsDuWxVSylw9bulVc90RJJPTUOdC8bI='; // Use the Secret from your DB

const sendPayload = (type, data) => {
    const payload = {
        schema_version: '1.0.0',
        instance_id: INSTANCE_ID,
        timestamp: new Date().toISOString(),
        nonce: crypto.randomUUID(),
        reporter_version: '1.0.0',
        telemetry_type: type,
        data: data
    };

    const payloadString = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', HMAC_SECRET).update(payloadString).digest('base64');

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/ingest',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Sentinel-Signature': signature,
            'Content-Length': payloadString.length
        }
    };

    const req = http.request(options, (res) => {
        console.log(`[${type}] STATUS: ${res.statusCode}`);
        res.on('data', () => { });
    });

    req.on('error', (e) => console.error(`problem: ${e.message}`));
    req.write(payloadString);
    req.end();
};

// 1. Send Configuration
const configData = {
    workflows: [
        {
            remote_id: "wf_1",
            name: "AI Invoice Processor",
            is_active: true,
            node_count: 5,
            created_at: new Date().toISOString(),
            resources: [
                { type: "ai_model", identifier: "gpt-4o", provider: "openai", node_name: "AI Extractor" },
                { type: "google_sheet", identifier: "sheet_abc123", provider: "google", node_name: "Read Sheet" }
            ]
        }
    ]
};
console.log('Sending configuration...');
sendPayload('configuration', configData);

// 2. Send Executions (Wait a bit to ensure workflow exists)
setTimeout(() => {
    const execData = {
        executions: [
            {
                remote_execution_id: "exec_1",
                workflow_remote_id: "wf_1",
                status: "success",
                started_at: new Date().toISOString(),
                finished_at: new Date().toISOString(),
                duration_ms: 2500,
                token_usage: [
                    { model: "gpt-4o", provider: "openai", tokens_input: 100, tokens_output: 50, accuracy: "exact" }
                ]
            }
        ]
    };
    console.log('Sending executions...');
    sendPayload('executions', execData);
}, 2000);
