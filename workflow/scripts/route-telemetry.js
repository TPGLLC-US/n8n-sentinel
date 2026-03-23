// Detect which trigger fired this execution
// $('NodeName').first() throws if the node wasn't executed in this run
let trigger = 'manual';
let syncParams = {};
try { $('Heartbeat (5m)').first(); trigger = 'heartbeat'; } catch(e) {}
try { $('Executions (8h)').first(); trigger = 'executions'; } catch(e) {}
try { $('Config (6h)').first(); trigger = 'configuration'; } catch(e) {}
try { $('Error Trigger').first(); trigger = 'error'; } catch(e) {}
try {
  const wh = $('Manual Webhook').first();
  trigger = 'manual';
  syncParams.timeframe = wh.json.body?.timeframe || '1h';
  syncParams.level = wh.json.body?.level || 'simple';
} catch(e) {}

return [{ json: { telemetry_type: trigger, syncParams } }];
