// Process Executions: Merge execution metadata + token data from Extract Tokens loop
// Execution list comes from $('Get Executions') n8n node, token data from $input (Aggregate)

// 1. Get execution metadata (n8n node returns items directly, no data wrapper)
let executions = [];
try {
  executions = $('Get Executions').all().map(i => i.json);
} catch (e) {
  executions = [];
}

// 2. Get token data from the Extract Tokens → Aggregate path
let tokenRows = [];
try {
  const rawItems = $input.all().map(i => i.json);
  if (rawItems.length === 1 && Array.isArray(rawItems[0].data)) {
    tokenRows = rawItems[0].data;
  } else if (rawItems.length > 0 && rawItems[0].execution_id) {
    tokenRows = rawItems;
  } else {
    tokenRows = rawItems.flatMap(r => r.data || [r]);
  }
} catch (e) {
  tokenRows = [];
}

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
