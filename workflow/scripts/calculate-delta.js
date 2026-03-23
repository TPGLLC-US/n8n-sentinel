// Delta Execution Sync Logic
// Use fixed lookback windows instead of persisted state
const trigger = $('Route Telemetry').first().json.telemetry_type;

// 8h lookback for scheduled syncs, 1h for manual
const lookbackMs = trigger === 'manual' ? 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
const since = new Date(Date.now() - lookbackMs).toISOString();

return [{ json: { filter: `startedAfter=${encodeURIComponent(since)}` } }];
