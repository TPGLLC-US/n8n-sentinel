# Forecasting

**Purpose.** Short-term token-usage forecasts (input / output) for monitored workflows. The implementation uses additive Holt-Winters (triple exponential smoothing, 24-hour season) with seasonal naive baselines as a quality floor, rolling backtest for model selection, and variance-based confidence bands.

**Entry points.**
- `GET /api/metrics/forecast/tokens` — `server/src/routes/metrics.ts:243`. Optional query params: `?instance_id=...&history_hours=168&forecast_hours=24` (`:247`). Calls `runTokenForecast(buckets, forecastHours)` at `:292`.
- Mounted under `requireAuth` at `server/src/index.ts:101` (`/api/metrics`).

**Key file and functions (`server/src/services/forecasting.ts`).**
- `runTokenForecast(buckets, forecastHours = 24)` — exported main entry at `:378-412`. Runs `forecastSeries` on input and output arrays independently, then zips the results into `ForecastPoint[]` anchored on the last observed hour.
- Holt-Winters:
  - `hwInit(y)` — `:73`. Initial level/trend/seasonal from first two seasons.
  - `hwFit(y, params)` — `:107`. Additive recurrence, returns `{fitted, state}`.
  - `hwForecast(state, h)` — `:134`. Projects `h` steps using final level/trend and seasonal array.
  - `optimizeHWParams(y)` — `:247`. Grid search over α/β/γ on an internal validation set (last SEASON points), optimizing WAPE.
- Baselines: `seasonalNaive(y, lag, h)` — `:150`. `lag = 24` for naive-yesterday, `168` for naive-last-week.
- Metrics: `mae` (`:162`), `wape` (`:170`).
- Backtests: `backtestHW(y, testSize, params)` (`:194`) and `backtestNaive(y, testSize, lag, label)` (`:219`) both produce `BacktestResult { method, mae, wape, forecasts, errors }`.
- Bands: `confidenceBands(forecast, errors, z = 1.96)` — `:287`. σ from backtest error residuals, widens with `sqrt(1 + h / SEASON)`; lower bound clamped to 0.
- Per-series driver: `forecastSeries(y, forecastHours)` — `:318`. Computes test size `min(SEASON, floor(n * 0.2))`, runs HW + both naives (when enough history), picks the lowest-WAPE candidate, and produces rounded values plus bands.

**Method choice rationale.**
- Holt-Winters handles level, trend, and 24h seasonality — the right shape for intraday workflow load.
- Seasonal-naive (yesterday-same-hour and last-week-same-hour) acts as a cheap sanity baseline. If HW cannot beat naive on WAPE, `forecastSeries` returns the naive forecast instead, so the API never regresses below a "carry the pattern forward" prediction.
- Guardrails on history length: HW needs ≥ 2×SEASON samples (`:322-324`); naive-week needs > 168 samples (`:330-332`). Insufficient history yields `Infinity` WAPE so those candidates are filtered out of the ranking.
- `optimizeHWParams` bails to defaults (α=0.2, β=0.01, γ=0.1) when history < 3×SEASON (`:254`).

**Data flow.**
1. Client requests `/api/metrics/forecast/tokens`.
2. Route (`metrics.ts:243-297`) aggregates per-hour token buckets from `token_usage` (clamped to 1..168 forecast hours at `:247`).
3. `runTokenForecast(buckets, forecastHours)` forecasts input and output independently.
4. Response includes `history`, `forecast`, per-series baseline metrics (so the UI can show "HW beat naive by X%"), season length, and forecast horizon.

**Known issues.** None at time of writing.

**Deep dive.** See `graphify-out/` for the Forecasting community — largely self-contained, coupled only to `routes/metrics.ts`. The seasonal constant `SEASON = 24` (`forecasting.ts:55`) is the knob that ties the method to hourly buckets; changing it requires updating the naive lags.
