const axios = require('axios');
const crypto = require('crypto');

const secret = 'test-secret'; // Assuming test-secret in dev DB

const payload = {
  schema_version: '1.0.0',
  instance_id: 'local-dev-1', // MUST correspond to instance in DB
  timestamp: new Date().toISOString(),
  nonce: Date.now().toString(),
  reporter_version: '1.1.0',
  telemetry_type: 'executions',
  instance_metadata: { n8n_version: '1.0.0' },
  data: {
    executions: [
      {
        remote_execution_id: 'exec-1',
        workflow_remote_id: 'wf-1',
        status: 'success',
        started_at: new Date().toISOString(),
        duration_ms: 100,
        data: {} // raw execution data required for extractor
      }
    ]
  }
};

const payloadString = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('base64');

axios.post('http://localhost:3000/api/ingest', payload, {
  headers: {
    'X-Sentinel-Signature': signature,
    'Content-Type': 'application/json'
  }
}).then(res => {
  console.log('Success:', res.status, res.data);
}).catch(err => {
  console.error('Error:', err.response ? err.response.data : err.message);
});
