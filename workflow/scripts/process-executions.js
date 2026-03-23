// Process Executions: Merge HTTP execution metadata + Postgres token data
// HTTP metadata comes from $('Get Executions'), token data from $input (Get Token Data)
// Token extraction happens in Postgres via SQL JSON functions — no large data transfer

// 1. Get execution metadata from HTTP response (handles paginated multi-page responses)
let executions = [];
try {
  const httpItems = $('Get Executions').all().map(i => i.json);
  if (httpItems.length === 1 && httpItems[0].data && Array.isArray(httpItems[0].data)) {
    executions = httpItems[0].data;
  } else if (httpItems.length > 1 && httpItems[0].data && Array.isArray(httpItems[0].data)) {
    executions = httpItems.flatMap(r => r.data || []);
  } else {
    executions = httpItems;
  }
} catch (e) {
  executions = [];
}

// 2. Get pre-extracted token data from Postgres (via Get Token Data node)
const tokenRows = $input.all().map(i => i.json);

// 3. Group token rows by execution_id
const tokensByExec = {};
for (const row of tokenRows) {
  const execId = String(row.execution_id);
  if (!tokensByExec[execId]) tokensByExec[execId] = [];
  if ((row.tokens_input || 0) > 0 || (row.tokens_output || 0) > 0) {
    tokensByExec[execId].push({
      model: row.model || 'unknown',
      tokens_input: parseInt(row.tokens_input) || 0,
      tokens_output: parseInt(row.tokens_output) || 0,
      node_name: row.node_name || undefined,
    });
  }
}

// 4. Merge: attach token_usage to each execution, pass through error fields
const processed = executions.map(exec => {
  const execId = String(exec.id);

  // Extract error message from n8n's execution object if available
  const errorMsg = exec.error?.message || exec.error?.description || null;

  return {
    json: {
      id: exec.id,
      workflowId: exec.workflowId,
      status: exec.status,
      finished: exec.finished,
      mode: exec.mode,
      startedAt: exec.startedAt,
      stoppedAt: exec.stoppedAt,
      lastNodeExecuted: exec.lastNodeExecuted || null,
      error_message: errorMsg,
      token_usage: tokensByExec[execId] || [],
    }
  };
});

return processed;
