
const crypto = require('crypto');
const http = require('http');

const INSTANCE_ID = '8a5f775b-1750-4c4a-a1d3-29a2bd561553';
const HMAC_SECRET = 'mAl2jsyUH6U7xsDuWxVSylw9bulVc90RJJPTUOdC8bI=';

const payload = {
    schema_version: '1.0.0',
    instance_id: INSTANCE_ID,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    reporter_version: '1.0.0',
    telemetry_type: 'heartbeat',
    data: {
        active_workflows: 10,
        total_workflows: 12
    }
};

const payloadString = JSON.stringify(payload);

const signature = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payloadString)
    .digest('base64');

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
    console.log(`STATUS: ${res.statusCode}`);
    const data = [];
    res.on('data', (chunk) => data.push(chunk));
    res.on('end', () => {
        console.log('BODY:', Buffer.concat(data).toString());
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.write(payloadString);
req.end();
