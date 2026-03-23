import { useEffect, useState } from 'react';
import { Server, FileJson, Play, AlertTriangle, Coins, Check, Loader2, X, ExternalLink } from 'lucide-react';
import { authFetch } from '../lib/auth';
import { Link } from 'react-router-dom';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';

interface Instance {
    id: string;
    name: string;
    environment: string;
    is_active: boolean;
    last_heartbeat: string | null;
    workflow_count: number;
    active_workflow_count: number;
    executions_24h: number;
    errors_24h: number;
}

interface Alert {
    id: string;
    alert_type: string;
    severity: string;
    message: string;
    instance_name: string;
    triggered_at: string;
}

interface ForecastPoint {
    hour: string;
    inputForecast: number;
    inputLower: number;
    inputUpper: number;
    outputForecast: number;
    outputLower: number;
    outputUpper: number;
}

interface BaselineMetric {
    method: string;
    mae: number;
    wape: number;
}

interface SeriesForecast {
    forecastMethod: string;
    baselines: BaselineMetric[];
    values: number[];
    lower: number[];
    upper: number[];
}

interface TokenForecast {
    history: { hour: string; input: number; output: number; total: number }[];
    forecast: ForecastPoint[];
    input: SeriesForecast;
    output: SeriesForecast;
    seasonLength: number;
    forecastHours: number;
}

interface OverviewMetrics {
    workflows: { total: number; active: number };
    executionsPeriod: { total: number; success: number; errors: number };
    tokensPeriod: { input: number; output: number };
    executionTrend: { date: string; total: number; success: number; errors: number }[];
    errorRateTrend: { date: string; error_rate: number }[];
    tokenTrend: { date: string; input: number; output: number }[];
    topFailingWorkflows: { workflow_name: string; instance_name: string; error_count: number; total_count: number; error_rate: number }[];
    instanceHealth: { instance_id: string; instance_name: string; date: string; total: number; errors: number; error_rate: number }[];
    execDistribution: { instance_name: string; total: number; success: number; errors: number }[];
    hours: number;
}

type TimeRange = 1 | 12 | 24 | 168 | 720;
const TIME_RANGES: { value: TimeRange; label: string }[] = [
    { value: 1, label: '1 Hr' },
    { value: 12, label: '12 Hr' },
    { value: 24, label: '1 D' },
    { value: 168, label: '7 D' },
    { value: 720, label: '30 D' },
];

const FORECAST_MAP: Record<TimeRange, { history: number; forecast: number }> = {
    1: { history: 48, forecast: 1 },
    12: { history: 48, forecast: 6 },
    24: { history: 72, forecast: 12 },
    168: { history: 336, forecast: 72 },
    720: { history: 720, forecast: 168 },
};

export default function Overview() {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [acknowledging, setAcknowledging] = useState<string | null>(null);
    const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
    const [timeRange, setTimeRange] = useState<TimeRange>(168);
    const [tokenForecast, setTokenForecast] = useState<TokenForecast | null>(null);

    const fetchMetrics = (instanceId?: string, hours?: TimeRange) => {
        const params = new URLSearchParams();
        if (instanceId) params.set('instance_id', instanceId);
        params.set('hours', String(hours ?? timeRange));
        authFetch(`/metrics/overview?${params}`).then(r => r.json()).then(setMetrics).catch(console.error);
    };

    const fetchForecast = (instanceId?: string, hours?: TimeRange) => {
        const fc = FORECAST_MAP[hours ?? timeRange];
        const params = new URLSearchParams();
        if (instanceId) params.set('instance_id', instanceId);
        params.set('history_hours', String(fc.history));
        params.set('forecast_hours', String(fc.forecast));
        authFetch(`/metrics/forecast/tokens?${params}`).then(r => r.json()).then(setTokenForecast).catch(console.error);
    };

    useEffect(() => {
        const params = new URLSearchParams();
        params.set('hours', String(timeRange));
        Promise.all([
            authFetch('/instances').then(r => r.json()),
            authFetch('/alerts').then(r => r.json()),
            authFetch(`/metrics/overview?${params}`).then(r => r.json()),
            authFetch(`/metrics/forecast/tokens?history_hours=${FORECAST_MAP[timeRange].history}&forecast_hours=${FORECAST_MAP[timeRange].forecast}`).then(r => r.json()),
        ]).then(([instData, alertData, metricsData, forecastData]) => {
            setInstances(instData.instances || []);
            setAlerts((alertData.alerts || []).slice(0, 5));
            setMetrics(metricsData);
            setTokenForecast(forecastData);
        }).catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!loading) {
            fetchMetrics(selectedInstance?.id, timeRange);
            fetchForecast(selectedInstance?.id, timeRange);
        }
    }, [selectedInstance, timeRange]);

    const handleAcknowledge = async (alertId: string) => {
        setAcknowledging(alertId);
        try {
            await authFetch(`/alerts/${alertId}/acknowledge`, { method: 'POST' });
            setAlerts(prev => prev.filter(a => a.id !== alertId));
        } catch (e) { console.error(e); }
        finally { setAcknowledging(null); }
    };

    const heartbeatAge = (hb: string | null) => {
        if (!hb) return null;
        return Math.round((Date.now() - new Date(hb).getTime()) / 60000);
    };

    const instanceStatus = (inst: Instance) => {
        if (!inst.is_active) return { color: 'bg-gray-500', label: 'Disabled', ring: 'ring-gray-500/20' };
        const age = heartbeatAge(inst.last_heartbeat);
        if (age === null) return { color: 'bg-gray-500', label: 'Pending', ring: 'ring-gray-500/20' };
        if (age > 30) return { color: 'bg-red-500', label: 'Offline', ring: 'ring-red-500/20' };
        if (age > 10) return { color: 'bg-amber-500', label: 'Stale', ring: 'ring-amber-500/20' };
        return { color: 'bg-emerald-500', label: 'Healthy', ring: 'ring-emerald-500/20' };
    };

    const envColors: Record<string, string> = {
        production: 'bg-red-500/10 text-red-400 border-red-500/20',
        staging: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        development: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    };

    const sevColors: Record<string, string> = {
        critical: 'bg-red-500/10 text-red-400 border-red-500/20',
        warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    };

    const formatNumber = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
    );

    const useHourly = timeRange <= 24;
    const fmtDate = (d: string) => {
        const dt = new Date(d);
        if (useHourly) return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    const periodLabel = timeRange === 1 ? '1h' : timeRange === 12 ? '12h' : timeRange === 24 ? '24h' : timeRange === 168 ? '7d' : '30d';

    const trendData = (metrics?.executionTrend || []).map(d => ({ ...d, date: fmtDate(d.date) }));
    const errorRateData = (metrics?.errorRateTrend || []).map(d => ({ ...d, date: fmtDate(d.date) }));
    const tokenData = (metrics?.tokenTrend || []).map(d => ({ ...d, input: Number(d.input), output: Number(d.output), date: fmtDate(d.date) }));

    // Build merged token + forecast chart data
    interface FcChartPoint {
        date: string;
        input?: number;
        output?: number;
        inputFc?: number;
        inputLower?: number;
        inputBand?: number;
        outputFc?: number;
        outputLower?: number;
        outputBand?: number;
    }
    const forecastHrs = tokenForecast?.forecastHours ?? FORECAST_MAP[timeRange].forecast;
    const forecastLabel = forecastHrs >= 24 ? `${Math.round(forecastHrs / 24)}d` : `${forecastHrs}h`;
    // For longer forecasts, use date+time formatting
    const fmtFcDate = (d: string) => {
        const dt = new Date(d);
        if (forecastHrs >= 48) return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
        return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    };
    const tokenForecastData: FcChartPoint[] = [];
    if (tokenForecast) {
        const hist = tokenForecast.history;
        // Show proportional history: 2x forecast hours, capped to available
        const historyShow = Math.min(hist.length, forecastHrs * 2);
        const histSlice = hist.slice(Math.max(0, hist.length - historyShow));
        for (const h of histSlice) {
            tokenForecastData.push({
                date: fmtFcDate(h.hour),
                input: h.input,
                output: h.output,
            });
        }
        // Bridge: last historical point connects to first forecast for line continuity
        if (histSlice.length > 0 && tokenForecast.forecast.length > 0) {
            const last = tokenForecastData[tokenForecastData.length - 1];
            last.inputFc = last.input || 0;
            last.inputLower = last.input || 0;
            last.inputBand = 0;
            last.outputFc = last.output || 0;
            last.outputLower = last.output || 0;
            last.outputBand = 0;
        }
        for (const fc of tokenForecast.forecast) {
            tokenForecastData.push({
                date: fmtFcDate(fc.hour),
                inputFc: fc.inputForecast,
                inputLower: fc.inputLower,
                inputBand: fc.inputUpper - fc.inputLower,
                outputFc: fc.outputForecast,
                outputLower: fc.outputLower,
                outputBand: fc.outputUpper - fc.outputLower,
            });
        }
    }

    const methodLabels: Record<string, string> = {
        'holt-winters': 'Holt-Winters',
        'naive-yesterday': 'Same Hour Yesterday',
        'naive-last-week': 'Same Hour Last Week',
    };

    // Heatmap data transform
    const healthRows = metrics?.instanceHealth || [];
    const heatmapInstances = [...new Set(healthRows.map(r => r.instance_name))];
    const heatmapDates = [...new Set(healthRows.map(r => r.date))];
    const heatmapMap: Record<string, { total: number; errors: number; error_rate: number }> = {};
    healthRows.forEach(r => { heatmapMap[`${r.instance_name}|${r.date}`] = r; });

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold text-foreground">Overview</h1>

            {/* ─── Aggregate Metrics Row ─── */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <Link to="/instances" className="card p-4 rounded-lg hover:border-muted-foreground/20 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                        <Server size={14} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Instances</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{instances.length}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{instances.filter(i => i.is_active).length} active</p>
                </Link>
                <Link to="/workflows" className="card p-4 rounded-lg hover:border-muted-foreground/20 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                        <FileJson size={14} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Workflows</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{metrics?.workflows.total ?? '-'}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{metrics?.workflows.active ?? 0} active</p>
                </Link>
                <Link to="/executions" className="card p-4 rounded-lg hover:border-muted-foreground/20 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                        <Play size={14} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Executions ({periodLabel})</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{formatNumber(metrics?.executionsPeriod.total ?? 0)}</p>
                    <p className="text-[11px] mt-1">
                        <span className="text-emerald-400">{metrics?.executionsPeriod.success ?? 0} success</span>
                        {(metrics?.executionsPeriod.errors ?? 0) > 0 && (
                            <span className="text-red-400 ml-2">{metrics?.executionsPeriod.errors} errors</span>
                        )}
                    </p>
                </Link>
                <Link to="/tokens" className="card p-4 rounded-lg hover:border-muted-foreground/20 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                        <Coins size={14} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Tokens ({periodLabel})</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{formatNumber(Number(metrics?.tokensPeriod.input ?? 0) + Number(metrics?.tokensPeriod.output ?? 0))}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{formatNumber(Number(metrics?.tokensPeriod.input ?? 0))} in / {formatNumber(Number(metrics?.tokensPeriod.output ?? 0))} out</p>
                </Link>
                <Link to="/alerts" className="card p-4 rounded-lg hover:border-muted-foreground/20 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={14} className="text-red-400" />
                        <span className="text-xs text-muted-foreground">Active Alerts</span>
                    </div>
                    <p className={`text-2xl font-bold ${alerts.length > 0 ? 'text-red-400' : 'text-foreground'}`}>{alerts.length}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">unacknowledged</p>
                </Link>
            </div>

            {/* ─── Instance Cards Grid ─── */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-medium text-muted-foreground">Instances</h2>
                    <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-0.5">
                        {TIME_RANGES.map(tr => (
                            <button
                                key={tr.value}
                                onClick={() => setTimeRange(tr.value)}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                                    timeRange === tr.value
                                        ? 'bg-primary text-primary-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {tr.label}
                            </button>
                        ))}
                    </div>
                </div>
                {instances.length === 0 ? (
                    <div className="card rounded-lg p-8 text-center text-muted-foreground text-sm">
                        No instances registered. <Link to="/instances" className="text-primary hover:underline">Add your first instance →</Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {instances.map(inst => {
                            const status = instanceStatus(inst);
                            const age = heartbeatAge(inst.last_heartbeat);
                            const isSelected = selectedInstance?.id === inst.id;
                            return (
                                <div
                                    key={inst.id}
                                    onClick={() => setSelectedInstance(isSelected ? null : inst)}
                                    className={`card rounded-lg p-4 cursor-pointer transition-all duration-150 ${isSelected ? 'ring-2 ring-primary border-primary/40' : 'hover:border-muted-foreground/20'}`}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className={`w-2.5 h-2.5 rounded-full ${status.color} ring-4 ${status.ring}`} />
                                            <span className="font-medium text-foreground text-sm truncate max-w-[180px]">{inst.name}</span>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${envColors[inst.environment?.toLowerCase()] || 'bg-secondary text-muted-foreground border-border'}`}>
                                            {inst.environment || 'unknown'}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3 text-[11px]">
                                        <div>
                                            <div className="text-muted-foreground">Status</div>
                                            <div className="text-foreground font-medium">{status.label}</div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">Workflows</div>
                                            <div className="text-foreground font-medium">{inst.active_workflow_count}/{inst.workflow_count}</div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">Heartbeat</div>
                                            <div className="text-foreground font-medium">{age !== null ? (age < 1 ? '<1m' : `${age}m`) : '—'}</div>
                                        </div>
                                    </div>
                                    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px]">
                                        <div className="flex items-center gap-3">
                                            {inst.executions_24h > 0 && (
                                                <>
                                                    <span className="text-muted-foreground">{inst.executions_24h} exec/24h</span>
                                                    {inst.errors_24h > 0 && <span className="text-red-400">{inst.errors_24h} errors</span>}
                                                </>
                                            )}
                                        </div>
                                        <Link
                                            to={`/instances/${inst.id}`}
                                            onClick={e => e.stopPropagation()}
                                            className="text-primary hover:text-primary/80 flex items-center gap-1 text-[11px] font-medium"
                                        >
                                            View Instance <ExternalLink size={10} />
                                        </Link>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ─── Instance Filter Bar ─── */}
            {selectedInstance && (
                <div className="flex items-center gap-3">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-sm text-primary">
                        <Server size={14} />
                        <span className="font-medium">{selectedInstance.name}</span>
                        <button onClick={() => setSelectedInstance(null)} className="ml-1 hover:bg-primary/20 rounded p-0.5 transition-colors"><X size={14} /></button>
                    </div>
                    <span className="text-xs text-muted-foreground">Charts filtered to this instance</span>
                </div>
            )}

            {/* ─── Bottom Row: Chart + Alerts ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Execution Trend Chart */}
                <div className="lg:col-span-2 card rounded-lg p-5">
                    <h2 className="text-sm font-medium text-muted-foreground mb-4">Execution Trend ({periodLabel})</h2>
                    {trendData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} allowDecimals={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '8px', fontSize: '12px' }}
                                    labelStyle={{ color: '#ccc' }}
                                />
                                <Area type="monotone" dataKey="success" stroke="#10b981" fill="url(#successGrad)" strokeWidth={2} name="Success" />
                                <Area type="monotone" dataKey="errors" stroke="#ef4444" fill="url(#errorGrad)" strokeWidth={2} name="Errors" />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No execution data yet</div>
                    )}
                </div>

                {/* Recent Alerts Panel */}
                <div className="card rounded-lg p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-medium text-muted-foreground">Recent Alerts</h2>
                        <Link to="/alerts" className="text-[11px] text-primary hover:underline">View all →</Link>
                    </div>
                    {alerts.length === 0 ? (
                        <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">No active alerts</div>
                    ) : (
                        <div className="space-y-3">
                            {alerts.map(alert => (
                                <div key={alert.id} className="flex items-start gap-3 group">
                                    <span className={`shrink-0 mt-1 inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${sevColors[alert.severity] || sevColors.warning}`}>
                                        {alert.severity}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-foreground leading-snug line-clamp-2">{alert.message}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(alert.triggered_at).toLocaleString()}</p>
                                    </div>
                                    <button
                                        onClick={(e) => { e.preventDefault(); handleAcknowledge(alert.id); }}
                                        disabled={acknowledging === alert.id}
                                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-emerald-500/10 text-emerald-400 disabled:opacity-50"
                                        title="Acknowledge"
                                    >
                                        {acknowledging === alert.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {/* ─── Row 2: Error Rate + Token Trend ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Error Rate Trend */}
                <div className="card rounded-lg p-5">
                    <h2 className="text-sm font-medium text-muted-foreground mb-4">Error Rate Trend ({periodLabel})</h2>
                    <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={errorRateData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="errorRateGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} unit="%" domain={[0, 'auto']} />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '8px', fontSize: '12px' }}
                                labelStyle={{ color: '#ccc' }}
                                formatter={(value: any) => [`${value}%`, 'Error Rate']}
                            />
                            <Area type="monotone" dataKey="error_rate" stroke="#ef4444" fill="url(#errorRateGrad)" strokeWidth={2} name="Error Rate" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Token Usage Trend */}
                <div className="card rounded-lg p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-medium text-muted-foreground">Token Usage Trend ({periodLabel})</h2>
                        {tokenForecast && (
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                    In: {methodLabels[tokenForecast.input.forecastMethod] || tokenForecast.input.forecastMethod}
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                    Out: {methodLabels[tokenForecast.output.forecastMethod] || tokenForecast.output.forecastMethod}
                                </span>
                            </div>
                        )}
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={tokenData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="tokenInputGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="tokenOutputGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '8px', fontSize: '12px' }}
                                labelStyle={{ color: '#ccc' }}
                                formatter={(value: any) => [formatNumber(Number(value)), undefined]}
                            />
                            <Area type="monotone" dataKey="input" stroke="#6366f1" fill="url(#tokenInputGrad)" strokeWidth={2} name="Input" />
                            <Area type="monotone" dataKey="output" stroke="#a78bfa" fill="url(#tokenOutputGrad)" strokeWidth={2} name="Output" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* ─── Token Forecast (48h history + 24h forecast) ─── */}
            {tokenForecastData.length > 0 && (
                <div className="card rounded-lg p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <h2 className="text-sm font-medium text-muted-foreground">Token Forecast ({forecastLabel} ahead)</h2>
                            <div className="flex items-center gap-1.5">
                                <span className="w-6 h-0.5 bg-indigo-500 rounded inline-block" />
                                <span className="text-[10px] text-muted-foreground">Input</span>
                                <span className="w-6 h-0.5 bg-violet-400 rounded inline-block ml-2" />
                                <span className="text-[10px] text-muted-foreground">Output</span>
                                <span className="w-6 h-0.5 rounded inline-block border-t border-dashed border-indigo-400 ml-2" />
                                <span className="text-[10px] text-muted-foreground">Forecast</span>
                                <span className="w-6 h-2 rounded inline-block bg-indigo-400/10 ml-2" />
                                <span className="text-[10px] text-muted-foreground">95% CI</span>
                            </div>
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                        <AreaChart data={tokenForecastData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="fcHistGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="fcHistOutGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="fcInputBandGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.12} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                                </linearGradient>
                                <linearGradient id="fcOutputBandGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.12} />
                                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} interval={Math.max(Math.floor(tokenForecastData.length / 12), 0)} />
                            <YAxis tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '8px', fontSize: '12px' }}
                                labelStyle={{ color: '#ccc' }}
                                formatter={(value: any, name: any) => {
                                    const n = String(name);
                                    if (n.includes('Lower') || n.includes('Band')) return [null, null];
                                    const labels: Record<string, string> = { input: 'Input', output: 'Output', inputFc: 'Input Forecast', outputFc: 'Output Forecast' };
                                    return [formatNumber(Number(value)), labels[n] || n];
                                }}
                                itemSorter={() => 0}
                            />
                            {/* Input confidence band */}
                            <Area type="monotone" dataKey="inputLower" stackId="ciIn" stroke="none" fill="transparent" name="inputLower" connectNulls={false} />
                            <Area type="monotone" dataKey="inputBand" stackId="ciIn" stroke="none" fill="url(#fcInputBandGrad)" name="inputBand" connectNulls={false} />
                            {/* Output confidence band */}
                            <Area type="monotone" dataKey="outputLower" stackId="ciOut" stroke="none" fill="transparent" name="outputLower" connectNulls={false} />
                            <Area type="monotone" dataKey="outputBand" stackId="ciOut" stroke="none" fill="url(#fcOutputBandGrad)" name="outputBand" connectNulls={false} />
                            {/* Historical input/output */}
                            <Area type="monotone" dataKey="input" stroke="#6366f1" fill="url(#fcHistGrad)" strokeWidth={2} name="input" connectNulls={false} />
                            <Area type="monotone" dataKey="output" stroke="#a78bfa" fill="url(#fcHistOutGrad)" strokeWidth={1.5} name="output" connectNulls={false} />
                            {/* Forecast lines */}
                            <Area type="monotone" dataKey="inputFc" stroke="#6366f1" fill="none" strokeWidth={2} strokeDasharray="6 3" name="inputFc" connectNulls={false} />
                            <Area type="monotone" dataKey="outputFc" stroke="#a78bfa" fill="none" strokeWidth={2} strokeDasharray="6 3" name="outputFc" connectNulls={false} />
                            {/* Now boundary line */}
                            {tokenForecast && tokenForecast.history.length > 0 && (
                                <ReferenceLine
                                    x={fmtFcDate(tokenForecast.history[tokenForecast.history.length - 1].hour)}
                                    stroke="#555"
                                    strokeDasharray="4 4"
                                    label={{ value: 'Now', position: 'top', fill: '#888', fontSize: 10 }}
                                />
                            )}
                        </AreaChart>
                    </ResponsiveContainer>
                    {/* Baseline comparison — input & output */}
                    {tokenForecast && (
                        <div className="mt-3 pt-3 border-t border-border/50 space-y-1.5">
                            {[
                                { label: 'Input', series: tokenForecast.input, color: 'text-indigo-400', dotColor: 'bg-indigo-400' },
                                { label: 'Output', series: tokenForecast.output, color: 'text-violet-400', dotColor: 'bg-violet-400' },
                            ].map(({ label, series, color, dotColor }) => (
                                <div key={label} className="flex items-center gap-4 text-[11px]">
                                    <span className={`font-medium ${color} w-12`}>{label}</span>
                                    {series.baselines.map((b: BaselineMetric) => (
                                        <div key={b.method} className={`flex items-center gap-1.5 ${b.method === series.forecastMethod ? color : 'text-muted-foreground'}`}>
                                            {b.method === series.forecastMethod && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
                                            <span>{methodLabels[b.method] || b.method}</span>
                                            <span className="opacity-60">WAPE {b.wape >= 0 ? `${b.wape}%` : 'N/A'}</span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ─── Row 3: Top Failing Workflows + Execution Distribution ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Failing Workflows */}
                <div className="card rounded-lg p-5">
                    <h2 className="text-sm font-medium text-muted-foreground mb-4">Top Failing Workflows ({periodLabel})</h2>
                    {(metrics?.topFailingWorkflows || []).length === 0 ? (
                        <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No failing workflows</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart
                                data={(metrics?.topFailingWorkflows || []).map(wf => ({ ...wf, name: wf.workflow_name.length > 18 ? wf.workflow_name.slice(0, 18) + '...' : wf.workflow_name }))}
                                layout="vertical"
                                margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                            >
                                <defs>
                                    <linearGradient id="failBarGrad" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.8} />
                                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} allowDecimals={false} />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#ccc' }} axisLine={false} tickLine={false} width={120} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '8px', fontSize: '12px' }}
                                    labelStyle={{ color: '#ccc' }}
                                    formatter={(value: any, _: any, item: any) => [
                                        `${value} errors (${item.payload.error_rate}%)`,
                                        `${item.payload.total_count} total`
                                    ]}
                                    labelFormatter={(label: any) => String(label)}
                                />
                                <Bar dataKey="error_count" fill="url(#failBarGrad)" radius={[0, 4, 4, 0]} name="Errors" barSize={16} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Execution Distribution by Instance */}
                <div className="card rounded-lg p-5">
                    <h2 className="text-sm font-medium text-muted-foreground mb-4">Execution Distribution ({periodLabel})</h2>
                    {(metrics?.execDistribution || []).length === 0 ? (
                        <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No execution data</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart
                                data={(metrics?.execDistribution || []).map(d => ({ ...d, name: d.instance_name.length > 18 ? d.instance_name.slice(0, 18) + '...' : d.instance_name }))}
                                layout="vertical"
                                margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                            >
                                <defs>
                                    <linearGradient id="distSuccessGrad" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.8} />
                                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.3} />
                                    </linearGradient>
                                    <linearGradient id="distErrorGrad" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.8} />
                                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} allowDecimals={false} />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#ccc' }} axisLine={false} tickLine={false} width={120} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '8px', fontSize: '12px' }}
                                    labelStyle={{ color: '#ccc' }}
                                    formatter={(value: any) => [formatNumber(Number(value)), undefined]}
                                />
                                <Legend
                                    iconType="circle"
                                    iconSize={8}
                                    wrapperStyle={{ fontSize: '11px', color: '#888', paddingTop: '8px' }}
                                />
                                <Bar dataKey="success" stackId="dist" fill="url(#distSuccessGrad)" radius={[0, 0, 0, 0]} name="Success" barSize={16} />
                                <Bar dataKey="errors" stackId="dist" fill="url(#distErrorGrad)" radius={[0, 4, 4, 0]} name="Errors" barSize={16} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* ─── Instance Health Heatmap ─── */}
            {heatmapInstances.length > 0 && (
                <div className="card rounded-lg p-5">
                    <h2 className="text-sm font-medium text-muted-foreground mb-4">Instance Health ({periodLabel})</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr>
                                    <th className="text-left text-[10px] text-muted-foreground font-medium pb-2 pr-4 w-[140px]">Instance</th>
                                    {heatmapDates.map(d => (
                                        <th key={d} className="text-center text-[10px] text-muted-foreground font-medium pb-2 px-1">
                                            {fmtDate(d)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {heatmapInstances.map(name => (
                                    <tr key={name}>
                                        <td className="text-xs text-foreground truncate max-w-[140px] pr-4 py-1" title={name}>{name}</td>
                                        {heatmapDates.map(d => {
                                            const cell = heatmapMap[`${name}|${d}`];
                                            const rate = cell?.error_rate ?? 0;
                                            const total = cell?.total ?? 0;
                                            const bg = total === 0 ? 'bg-secondary'
                                                : rate === 0 ? 'bg-emerald-500/30'
                                                : rate < 5 ? 'bg-emerald-500/20'
                                                : rate < 15 ? 'bg-amber-500/30'
                                                : rate < 30 ? 'bg-orange-500/40'
                                                : 'bg-red-500/50';
                                            return (
                                                <td key={d} className="px-1 py-1">
                                                    <div
                                                        className={`w-full h-7 rounded ${bg} flex items-center justify-center`}
                                                        title={`${name} • ${new Date(d).toLocaleDateString()}: ${total} exec, ${rate}% errors`}
                                                    >
                                                        {total > 0 && <span className="text-[9px] text-foreground/70">{rate}%</span>}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
                            <span>Error rate:</span>
                            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-secondary" /> None</div>
                            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-emerald-500/30" /> 0%</div>
                            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-500/30" /> 5–15%</div>
                            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-orange-500/40" /> 15–30%</div>
                            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-500/50" /> 30%+</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
