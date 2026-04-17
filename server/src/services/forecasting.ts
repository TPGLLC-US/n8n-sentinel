/**
 * Short-term execution forecasts using Holt–Winters additive triple exponential smoothing.
 *
 * Why Holt–Winters:
 *   - Workflow execution volume has daily/weekly seasonality.
 *   - HW captures level + trend + seasonality without training data assembly.
 *   - `backtestNaive` is kept as a floor check: if HW does worse than naïve-last-period,
 *     fall back to naïve so we never publish a worse forecast than no model at all.
 *
 * Implements:
 *   1. Additive Holt-Winters (triple exponential smoothing, season=24h)
 *   2. Seasonal naive baselines (same-hour-yesterday, same-hour-last-week)
 *   3. Rolling backtest with MAE / WAPE selection
 *   4. Confidence bands from forecast-error std dev
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HourlyBucket {
    hour: string;   // ISO timestamp (truncated to hour)
    input: number;
    output: number;
    total: number;
}

export interface ForecastPoint {
    hour: string;
    inputForecast: number;
    inputLower: number;
    inputUpper: number;
    outputForecast: number;
    outputLower: number;
    outputUpper: number;
}

export interface BaselineMetrics {
    method: string;
    mae: number;
    wape: number;
}

export interface SeriesForecastResult {
    forecastMethod: string;
    baselines: BaselineMetrics[];
    values: number[];
    lower: number[];
    upper: number[];
}

export interface ForecastResult {
    history: HourlyBucket[];
    forecast: ForecastPoint[];
    input: SeriesForecastResult;
    output: SeriesForecastResult;
    seasonLength: number;
    forecastHours: number;
}

// ─── Holt-Winters Additive ──────────────────────────────────────────────────

const SEASON = 24; // hours in one intraday cycle

interface HWParams {
    alpha: number;  // level smoothing
    beta: number;   // trend smoothing
    gamma: number;  // seasonal smoothing
}

interface HWState {
    level: number;
    trend: number;
    seasonal: number[];   // length = SEASON
}

/**
 * Initialize Holt-Winters state from the first two full seasons of data.
 * If fewer than 2 seasons are available, falls back to simpler initialization.
 */
function hwInit(y: number[]): HWState {
    const n = y.length;
    const s = SEASON;

    // Level: average of first season (or all data if short)
    const firstSeasonEnd = Math.min(s, n);
    let level = 0;
    for (let i = 0; i < firstSeasonEnd; i++) level += y[i];
    level /= firstSeasonEnd;

    // Trend: if we have ≥ 2 seasons, average difference between corresponding hours
    let trend = 0;
    if (n >= 2 * s) {
        for (let i = 0; i < s; i++) {
            trend += (y[i + s] - y[i]) / s;
        }
        trend /= s;
    }

    // Seasonal indices: deviation from level in first season
    const seasonal: number[] = new Array(s).fill(0);
    for (let i = 0; i < s; i++) {
        if (i < n) {
            seasonal[i] = y[i] - level;
        }
    }

    return { level, trend, seasonal };
}

/**
 * Run Holt-Winters additive model on observed data `y`.
 * Returns fitted values (in-sample) and the final state for forecasting.
 */
function hwFit(y: number[], params: HWParams): { fitted: number[]; state: HWState } {
    const { alpha, beta, gamma } = params;
    const n = y.length;
    const s = SEASON;
    const st = hwInit(y);

    let { level, trend } = st;
    const seasonal = [...st.seasonal];
    const fitted: number[] = [];

    for (let t = 0; t < n; t++) {
        const seasonIdx = t % s;
        const yhat = level + trend + seasonal[seasonIdx];
        fitted.push(Math.max(yhat, 0));

        const prevLevel = level;
        level = alpha * (y[t] - seasonal[seasonIdx]) + (1 - alpha) * (prevLevel + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
        seasonal[seasonIdx] = gamma * (y[t] - level) + (1 - gamma) * seasonal[seasonIdx];
    }

    return { fitted, state: { level, trend, seasonal } };
}

/**
 * Generate h-step-ahead forecasts from a fitted HW state.
 */
function hwForecast(state: HWState, h: number): number[] {
    const { level, trend, seasonal } = state;
    const s = SEASON;
    const fc: number[] = [];
    for (let i = 1; i <= h; i++) {
        const seasonIdx = (seasonal.length - s + ((i - 1) % s)) % s;
        fc.push(Math.max(level + i * trend + seasonal[seasonIdx], 0));
    }
    return fc;
}

// ─── Seasonal Naive Baselines ───────────────────────────────────────────────

/**
 * Seasonal naive: forecast = y[t - lag]
 */
function seasonalNaive(y: number[], lag: number, h: number): number[] {
    const n = y.length;
    const fc: number[] = [];
    for (let i = 0; i < h; i++) {
        const lookback = n - lag + (i % lag);
        fc.push(lookback >= 0 && lookback < n ? Math.max(y[lookback], 0) : 0);
    }
    return fc;
}

// ─── Error Metrics ──────────────────────────────────────────────────────────

function mae(actual: number[], predicted: number[]): number {
    const n = actual.length;
    if (n === 0) return Infinity;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(actual[i] - predicted[i]);
    return sum / n;
}

function wape(actual: number[], predicted: number[]): number {
    let sumAbs = 0;
    let sumActual = 0;
    for (let i = 0; i < actual.length; i++) {
        sumAbs += Math.abs(actual[i] - predicted[i]);
        sumActual += Math.abs(actual[i]);
    }
    return sumActual === 0 ? (sumAbs === 0 ? 0 : Infinity) : sumAbs / sumActual;
}

// ─── Rolling Backtest ───────────────────────────────────────────────────────

interface BacktestResult {
    method: string;
    mae: number;
    wape: number;
    forecasts: number[];
    errors: number[];
}

/**
 * Perform a rolling one-step-ahead backtest over the last `testSize` points.
 * For HW, re-fits on expanding window; for naive, just looks back.
 */
function backtestHW(y: number[], testSize: number, params: HWParams): BacktestResult {
    const trainEnd = y.length - testSize;
    const actual: number[] = [];
    const predicted: number[] = [];

    // Fit once on training data, then roll forward
    const { state } = hwFit(y.slice(0, trainEnd), params);

    // For simplicity in rolling backtest, we do a single fit + multi-step forecast
    const fc = hwForecast(state, testSize);
    for (let i = 0; i < testSize; i++) {
        actual.push(y[trainEnd + i]);
        predicted.push(fc[i]);
    }

    const errors = actual.map((a, i) => a - predicted[i]);
    return {
        method: 'holt-winters',
        mae: mae(actual, predicted),
        wape: wape(actual, predicted),
        forecasts: predicted,
        errors,
    };
}

function backtestNaive(y: number[], testSize: number, lag: number, label: string): BacktestResult {
    const trainEnd = y.length - testSize;
    const actual: number[] = [];
    const predicted: number[] = [];

    for (let i = 0; i < testSize; i++) {
        const t = trainEnd + i;
        const lookback = t - lag;
        actual.push(y[t]);
        predicted.push(lookback >= 0 ? Math.max(y[lookback], 0) : 0);
    }

    const errors = actual.map((a, i) => a - predicted[i]);
    return {
        method: label,
        mae: mae(actual, predicted),
        wape: wape(actual, predicted),
        forecasts: predicted,
        errors,
    };
}

// ─── HW Parameter Grid Search ───────────────────────────────────────────────

/**
 * Simple grid search for HW params on training data.
 * Evaluates on an internal validation set (last SEASON points of training).
 */
function optimizeHWParams(y: number[]): HWParams {
    const grid = [0.05, 0.1, 0.2, 0.3, 0.5];
    const gammaGrid = [0.01, 0.05, 0.1, 0.2, 0.3];
    let bestParams: HWParams = { alpha: 0.2, beta: 0.01, gamma: 0.1 };
    let bestWape = Infinity;

    // If not enough data for meaningful optimization, return defaults
    if (y.length < SEASON * 3) return bestParams;

    const valSize = SEASON;
    const trainY = y.slice(0, y.length - valSize);
    const valY = y.slice(y.length - valSize);

    for (const alpha of grid) {
        for (const beta of [0.001, 0.01, 0.05, 0.1]) {
            for (const gamma of gammaGrid) {
                try {
                    const { state } = hwFit(trainY, { alpha, beta, gamma });
                    const fc = hwForecast(state, valSize);
                    const w = wape(valY, fc);
                    if (w < bestWape) {
                        bestWape = w;
                        bestParams = { alpha, beta, gamma };
                    }
                } catch {
                    // skip invalid combos
                }
            }
        }
    }

    return bestParams;
}

// ─── Confidence Bands ───────────────────────────────────────────────────────

/**
 * Compute confidence bands from backtest errors.
 * Uses ±1.96 * σ for ~95% intervals, with widening by sqrt(h).
 */
function confidenceBands(
    forecast: number[],
    errors: number[],
    z: number = 1.96
): { lower: number[]; upper: number[] } {
    const n = errors.length;
    if (n === 0) {
        return {
            lower: forecast.map(() => 0),
            upper: forecast.map(f => f * 2),
        };
    }

    const mean = errors.reduce((s, e) => s + e, 0) / n;
    const variance = errors.reduce((s, e) => s + (e - mean) ** 2, 0) / n;
    const sigma = Math.sqrt(variance);

    const lower: number[] = [];
    const upper: number[] = [];
    for (let h = 0; h < forecast.length; h++) {
        // Widen bands with horizon
        const spread = z * sigma * Math.sqrt(1 + h / SEASON);
        lower.push(Math.max(forecast[h] - spread, 0));
        upper.push(forecast[h] + spread);
    }

    return { lower, upper };
}

// ─── Single-series forecast pipeline ────────────────────────────────────────

function forecastSeries(y: number[], forecastHours: number): SeriesForecastResult {
    const testSize = Math.min(SEASON, Math.floor(y.length * 0.2));

    const hwParams = optimizeHWParams(y);
    const hwBt = y.length >= SEASON * 2
        ? backtestHW(y, testSize, hwParams)
        : { method: 'holt-winters', mae: Infinity, wape: Infinity, forecasts: [], errors: [] };

    const naiveYesterday = y.length > SEASON
        ? backtestNaive(y, testSize, SEASON, 'naive-yesterday')
        : { method: 'naive-yesterday', mae: Infinity, wape: Infinity, forecasts: [], errors: [] };

    const naiveWeek = y.length > 168
        ? backtestNaive(y, testSize, 168, 'naive-last-week')
        : { method: 'naive-last-week', mae: Infinity, wape: Infinity, forecasts: [], errors: [] };

    const candidates = [hwBt, naiveYesterday, naiveWeek].filter(c => isFinite(c.wape));
    candidates.sort((a, b) => a.wape - b.wape);
    const best = candidates.length > 0 ? candidates[0] : hwBt;

    let forecastValues: number[];
    let forecastErrors: number[];

    if (best.method === 'holt-winters') {
        const { state } = hwFit(y, hwParams);
        forecastValues = hwForecast(state, forecastHours);
        forecastErrors = best.errors;
    } else {
        const lag = best.method === 'naive-last-week' ? 168 : SEASON;
        forecastValues = seasonalNaive(y, lag, forecastHours);
        forecastErrors = best.errors;
    }

    const bands = confidenceBands(forecastValues, forecastErrors);

    const baselines: BaselineMetrics[] = [
        { method: 'holt-winters', mae: round2(hwBt.mae), wape: round2(hwBt.wape * 100) },
        { method: 'naive-yesterday', mae: round2(naiveYesterday.mae), wape: round2(naiveYesterday.wape * 100) },
        { method: 'naive-last-week', mae: round2(naiveWeek.mae), wape: round2(naiveWeek.wape * 100) },
    ];

    return {
        forecastMethod: best.method,
        baselines,
        values: forecastValues.map(v => Math.round(v)),
        lower: bands.lower.map(v => Math.round(v)),
        upper: bands.upper.map(v => Math.round(v)),
    };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Run full forecast pipeline on hourly token data.
 * Forecasts input and output series independently.
 *
 * @param buckets  - Historical hourly buckets (ordered oldest→newest)
 * @param forecastHours - How many hours ahead to forecast (default 24)
 * @returns ForecastResult with history, per-series forecasts, baselines, confidence bands
 */
export function runTokenForecast(
    buckets: HourlyBucket[],
    forecastHours: number = 24
): ForecastResult {
    const inputY = buckets.map(b => b.input);
    const outputY = buckets.map(b => b.output);

    const inputResult = forecastSeries(inputY, forecastHours);
    const outputResult = forecastSeries(outputY, forecastHours);

    // Build combined forecast timestamps
    const lastHour = buckets.length > 0 ? new Date(buckets[buckets.length - 1].hour) : new Date();
    const forecastPoints: ForecastPoint[] = [];
    for (let i = 0; i < forecastHours; i++) {
        const dt = new Date(lastHour.getTime() + (i + 1) * 3600000);
        forecastPoints.push({
            hour: dt.toISOString(),
            inputForecast: inputResult.values[i],
            inputLower: inputResult.lower[i],
            inputUpper: inputResult.upper[i],
            outputForecast: outputResult.values[i],
            outputLower: outputResult.lower[i],
            outputUpper: outputResult.upper[i],
        });
    }

    return {
        history: buckets,
        forecast: forecastPoints,
        input: inputResult,
        output: outputResult,
        seasonLength: SEASON,
        forecastHours,
    };
}

function round2(n: number): number {
    return isFinite(n) ? Math.round(n * 100) / 100 : -1;
}
