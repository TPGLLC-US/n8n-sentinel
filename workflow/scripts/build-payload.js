const trigger = $('Route Telemetry').first().json.telemetry_type;

const SENTINEL_URL = 'YOUR_WEBHOOK_URL';
const INSTANCE_ID = 'YOUR_INSTANCE_ID';
const nonce = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

// Helper: unwrap n8n API responses which return { data: [...] }
// Handles both single-page and paginated (multi-page) responses
function unwrapApiResponse(items) {
  const raw = items.map(i => i.json);
  // Single item with a data array (single page or no pagination)
  if (raw.length === 1 && raw[0].data && Array.isArray(raw[0].data)) {
    return raw[0].data;
  }
  // Multiple items each with a data array (paginated response)
  if (raw.length > 1 && raw[0].data && Array.isArray(raw[0].data)) {
    return raw.flatMap(r => r.data || []);
  }
  return raw;
}

// Read real n8n settings (populated on heartbeat path via Get n8n Settings node)
// Response shape: { data: { versionCli, timezone, ... } }
let n8nSettings = {};
try {
  const raw = $('Get n8n Settings').first().json;
  n8nSettings = raw.data || raw || {};
} catch(e) {}

// Detect database type via Postgres probe (continueOnFail node)
// If the probe succeeded, the n8n instance uses Postgres. If it failed, assume unknown/sqlite.
let dbType = null;
try {
  const dbProbe = $('Detect DB Type').first().json;
  if (dbProbe && dbProbe.database_type) dbType = dbProbe.database_type;
} catch(e) {}

const payload = {
  schema_version: '1.0.0',
  instance_id: INSTANCE_ID,
  timestamp: new Date().toISOString(),
  nonce: nonce,
  reporter_version: '1.4.0',
  telemetry_type: trigger,
  instance_metadata: {
    n8n_version: n8nSettings.versionCli || null,
    database_type: dbType,
    instance_url: (() => {
      try {
        const cb = n8nSettings.oauthCallbackUrls?.oauth2;
        if (cb) { const u = new URL(cb); return u.origin; }
      } catch(e) {}
      return null;
    })(),
    timezone: n8nSettings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  },
  data: {}
};

if (trigger === 'configuration') {
  try {
    const wfItems = unwrapApiResponse($('Get Workflows').all());
    payload.data.workflows = wfItems;
  } catch (e) {
    payload.data.workflows = [];
  }
} else if (trigger === 'executions' || trigger === 'manual') {
  try {
    // Process Executions already unwrapped API response and extracted tokens
    const execItems = $('Process Executions').all().map(i => i.json);
    payload.data.executions = execItems;
  } catch (e) {
    payload.data.executions = [];
  }
} else if (trigger === 'error') {
  try {
    const raw = $('Error Trigger').first().json;
    // n8n Error Trigger shape: { execution: { id, error, lastNodeExecuted, mode, startedAt, stoppedAt }, workflow: { id, name } }
    const exec = raw.execution || {};
    const wf = raw.workflow || {};
    const errObj = exec.error || {};
    payload.data.error = {
      id: exec.id,
      workflowId: wf.id,
      workflowName: wf.name,
      status: 'error',
      startedAt: exec.startedAt || exec.started_at,
      stoppedAt: exec.stoppedAt || exec.stopped_at,
      mode: exec.mode,
      error_message: errObj.message || errObj.description || raw.message || 'Unknown error',
      error_node: exec.lastNodeExecuted || null,
    };
  } catch (e) {
    payload.data.error = { status: 'error', error_message: 'Error data unavailable' };
  }
}

return [{
  json: {
    url: SENTINEL_URL,
    payload: payload,
    payloadString: JSON.stringify(payload)
  }
}];
