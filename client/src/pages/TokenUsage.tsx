import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { authFetch } from '../lib/auth';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    flexRender,
    createColumnHelper,
    type SortingState,
    type ColumnFiltersState,
} from '@tanstack/react-table';

// Cost per 1K tokens by model (input / output) — common models
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-5-haiku': { input: 0.0008, output: 0.004 },
    'claude-3-opus': { input: 0.015, output: 0.075 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-haiku': { input: 0.00025, output: 0.00125 },
    'claude-sonnet-4': { input: 0.003, output: 0.015 },
    'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
    'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
    'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
};

function estimateCost(model: string, tokensInput: number, tokensOutput: number): number | null {
    if (!model || model === 'unknown') return null;
    const key = Object.keys(MODEL_COSTS).find(k => model.toLowerCase().includes(k));
    if (!key) return null;
    const rates = MODEL_COSTS[key];
    return (tokensInput / 1000) * rates.input + (tokensOutput / 1000) * rates.output;
}

interface Instance {
    id: string;
    name: string;
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

const METHOD_LABELS: Record<string, string> = {
    'holt-winters': 'Holt-Winters',
    'naive-yesterday': 'Same Hour Yesterday',
    'naive-last-week': 'Same Hour Last Week',
};

interface TokenRow {
    id: string;
    recorded_at: string;
    model: string;
    provider: string;
    tokens_input: number;
    tokens_output: number;
    accuracy: string;
    source: string;
    call_type: string | null;
    remote_execution_id: string;
    execution_status: string;
    execution_started_at: string;
    workflow_name: string;
    workflow_remote_id: string;
}

const columnHelper = createColumnHelper<TokenRow>();

export default function TokenUsage() {
    const [rows, setRows] = useState<TokenRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'recorded_at', desc: true }]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = useState('');
    const [sourceFilter, setSourceFilter] = useState<'all' | 'workflow' | 'sentinel'>('all');
    const [instances, setInstances] = useState<Instance[]>([]);
    const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
    const [timeRange, setTimeRange] = useState<TimeRange>(168);
    const [tokenTrend, setTokenTrend] = useState<{ date: string; input: number; output: number }[]>([]);
    const [tokenForecast, setTokenForecast] = useState<TokenForecast | null>(null);

    const fetchTrend = (instanceId?: string, hours?: TimeRange) => {
        const params = new URLSearchParams();
        if (instanceId) params.set('instance_id', instanceId);
        params.set('hours', String(hours ?? timeRange));
        authFetch(`/metrics/overview?${params}`).then(r => r.json()).then(data => {
            setTokenTrend(data.tokenTrend || []);
        }).catch(console.error);
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
            authFetch('/metrics/tokens/detail?limit=500').then(r => r.json()),
            authFetch('/instances').then(r => r.json()),
            authFetch(`/metrics/overview?${params}`).then(r => r.json()),
            authFetch(`/metrics/forecast/tokens?history_hours=${FORECAST_MAP[timeRange].history}&forecast_hours=${FORECAST_MAP[timeRange].forecast}`).then(r => r.json()),
        ])
            .then(([detail, instData, overviewData, forecastData]) => {
                setRows((detail.rows || []).map((r: any) => ({
                    ...r,
                    tokens_input: parseInt(r.tokens_input) || 0,
                    tokens_output: parseInt(r.tokens_output) || 0,
                    source: r.source || 'workflow',
                    call_type: r.call_type || null,
                })));
                setTotal(detail.total || 0);
                setInstances(instData.instances || []);
                setTokenTrend(overviewData.tokenTrend || []);
                setTokenForecast(forecastData);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!loading) {
            fetchTrend(selectedInstance?.id, timeRange);
            fetchForecast(selectedInstance?.id, timeRange);
        }
    }, [selectedInstance, timeRange]);

    const columns = useMemo(() => [
        columnHelper.accessor('recorded_at', {
            header: 'Date',
            cell: info => new Date(info.getValue()).toLocaleString(),
            sortingFn: 'datetime',
        }),
        columnHelper.accessor('workflow_name', {
            header: 'Workflow',
            cell: info => {
                const row = info.row.original;
                const isSentinel = row.source === 'sentinel';
                const name = info.getValue() || '—';
                return (
                    <span className={`font-medium truncate max-w-[240px] block ${isSentinel ? 'text-violet-400' : 'text-primary'}`} title={isSentinel ? `Sentinel - ${name}` : name}>
                        {isSentinel && <span className="text-violet-400/70">Sentinel - </span>}{name}
                    </span>
                );
            },
        }),
        columnHelper.accessor('model', {
            header: 'Model',
            cell: info => (
                <span className="font-mono text-xs">{info.getValue() || 'unknown'}</span>
            ),
        }),
        columnHelper.accessor('provider', {
            header: 'Provider',
            cell: info => {
                const provider = info.getValue();
                if (!provider || provider === 'unknown') return <span className="text-muted-foreground">—</span>;
                return (
                    <span className="flex items-center gap-1.5">
                        <img
                            src={`https://models.dev/logos/${provider}.svg`}
                            alt=""
                            className="w-4 h-4"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="capitalize">{provider}</span>
                    </span>
                );
            },
        }),
        columnHelper.accessor('tokens_input', {
            header: 'Input',
            cell: info => <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>,
            meta: { align: 'right' },
        }),
        columnHelper.accessor('tokens_output', {
            header: 'Output',
            cell: info => <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>,
            meta: { align: 'right' },
        }),
        columnHelper.display({
            id: 'cost',
            header: 'Est. Cost',
            cell: ({ row }) => {
                const cost = estimateCost(row.original.model, row.original.tokens_input, row.original.tokens_output);
                if (cost === null) return <span className="text-muted-foreground">—</span>;
                return <span className="font-mono tabular-nums text-emerald-400">${cost.toFixed(4)}</span>;
            },
            meta: { align: 'right' },
        }),
        columnHelper.accessor('source', {
            header: 'Source',
            cell: info => {
                const src = info.getValue();
                const callType = info.row.original.call_type;
                if (src === 'sentinel') {
                    return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border bg-violet-500/10 text-violet-400 border-violet-500/20">
                            {callType === 'diagnosis' ? 'Diagnose' : callType === 'fix' ? 'AI Fix' : 'Sentinel'}
                        </span>
                    );
                }
                return <span className="text-[10px] text-muted-foreground/60 uppercase">Workflow</span>;
            },
        }),
        columnHelper.accessor('execution_status', {
            header: 'Status',
            cell: info => {
                const s = info.getValue();
                const color = s === 'success' ? 'text-emerald-400' : s === 'error' ? 'text-red-400' : 'text-amber-400';
                return <span className={`text-xs font-semibold uppercase ${color}`}>{s}</span>;
            },
        }),
    ], []);

    const filteredRows = useMemo(() => {
        if (sourceFilter === 'all') return rows;
        return rows.filter(r => r.source === sourceFilter);
    }, [rows, sourceFilter]);

    const table = useReactTable({
        data: filteredRows,
        columns,
        state: { sorting, columnFilters, globalFilter },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: { pagination: { pageSize: 20 } },
    });

    if (loading) return <div className="p-8 text-muted-foreground animate-pulse">Loading usage...</div>;

    const totalInput = filteredRows.reduce((acc, r) => acc + r.tokens_input, 0);
    const totalOutput = filteredRows.reduce((acc, r) => acc + r.tokens_output, 0);
    const totalCost = filteredRows.reduce((acc, r) => {
        const cost = estimateCost(r.model, r.tokens_input, r.tokens_output);
        return acc + (cost || 0);
    }, 0);
    const hasKnownCost = filteredRows.some(r => estimateCost(r.model, r.tokens_input, r.tokens_output) !== null);
    const sentinelCount = rows.filter(r => r.source === 'sentinel').length;
    const workflowCount = rows.filter(r => r.source === 'workflow').length;

    const useHourly = timeRange <= 24;
    const fmtDate = (d: string) => {
        const dt = new Date(d);
        if (useHourly) return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    const periodLabel = timeRange === 1 ? '1h' : timeRange === 12 ? '12h' : timeRange === 24 ? '24h' : timeRange === 168 ? '7d' : '30d';
    const formatNumber = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

    const trendChartData = tokenTrend.map(d => ({ ...d, input: Number(d.input), output: Number(d.output), date: fmtDate(d.date) }));

    // Forecast chart data
    const forecastHrs = tokenForecast?.forecastHours ?? FORECAST_MAP[timeRange].forecast;
    const forecastLabel = forecastHrs >= 24 ? `${Math.round(forecastHrs / 24)}d` : `${forecastHrs}h`;
    const fmtFcDate = (d: string) => {
        const dt = new Date(d);
        if (forecastHrs >= 48) return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
        return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    };
    interface FcPt { date: string; input?: number; output?: number; inputFc?: number; inputLower?: number; inputBand?: number; outputFc?: number; outputLower?: number; outputBand?: number; }
    const fcData: FcPt[] = [];
    if (tokenForecast) {
        const hist = tokenForecast.history;
        const historyShow = Math.min(hist.length, forecastHrs * 2);
        const histSlice = hist.slice(Math.max(0, hist.length - historyShow));
        for (const h of histSlice) fcData.push({ date: fmtFcDate(h.hour), input: h.input, output: h.output });
        if (histSlice.length > 0 && tokenForecast.forecast.length > 0) {
            const last = fcData[fcData.length - 1];
            last.inputFc = last.input || 0; last.inputLower = last.input || 0; last.inputBand = 0;
            last.outputFc = last.output || 0; last.outputLower = last.output || 0; last.outputBand = 0;
        }
        for (const fc of tokenForecast.forecast) {
            fcData.push({
                date: fmtFcDate(fc.hour),
                inputFc: fc.inputForecast, inputLower: fc.inputLower, inputBand: fc.inputUpper - fc.inputLower,
                outputFc: fc.outputForecast, outputLower: fc.outputLower, outputBand: fc.outputUpper - fc.outputLower,
            });
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold text-foreground">Token Usage</h1>
                <div className="flex items-center gap-3">
                    {/* Instance filter */}
                    {instances.length > 0 && (
                        <select
                            value={selectedInstance?.id || ''}
                            onChange={e => {
                                const inst = instances.find(i => i.id === e.target.value) || null;
                                setSelectedInstance(inst);
                            }}
                            className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-xs text-foreground"
                        >
                            <option value="">All Instances</option>
                            {instances.map(inst => (
                                <option key={inst.id} value={inst.id}>{inst.name}</option>
                            ))}
                        </select>
                    )}
                    {/* Time range filter */}
                    <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-0.5">
                        {TIME_RANGES.map(tr => (
                            <button
                                key={tr.value}
                                onClick={() => setTimeRange(tr.value)}
                                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                                    timeRange === tr.value
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {tr.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Instance filter bar */}
            {selectedInstance && (
                <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-primary/5 border border-primary/10">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        <span>{selectedInstance.name}</span>
                        <button onClick={() => setSelectedInstance(null)} aria-label="Clear instance filter" className="ml-1 hover:bg-primary/20 rounded p-0.5 transition-colors"><X size={14} /></button>
                    </div>
                    <span className="text-xs text-muted-foreground">Charts filtered to this instance</span>
                </div>
            )}

            {/* Source filter tabs */}
            <div className="flex items-center gap-2">
                {(['all', 'workflow', 'sentinel'] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => setSourceFilter(s)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors duration-150 ${
                            sourceFilter === s
                                ? 'bg-accent text-foreground border-border'
                                : 'text-muted-foreground border-transparent hover:text-foreground'
                        }`}
                    >
                        {s === 'all' ? `All (${rows.length})` : s === 'workflow' ? `Workflow (${workflowCount})` : `Sentinel (${sentinelCount})`}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard label="Total Input Tokens" value={totalInput.toLocaleString()} />
                <StatCard label="Total Output Tokens" value={totalOutput.toLocaleString()} />
                <StatCard label="Total Calls" value={total.toLocaleString()} />
                <StatCard
                    label="Est. Cost (USD)"
                    value={hasKnownCost ? `$${totalCost.toFixed(4)}` : '—'}
                    subtitle={hasKnownCost ? undefined : 'Model required for cost'}
                    icon={<TrendingUp size={20} className="text-emerald-500" />}
                />
            </div>

            {/* ─── Token Usage Trend ─── */}
            <div className="card rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-muted-foreground">Token Usage Trend ({periodLabel})</h2>
                    {tokenForecast && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                In: {METHOD_LABELS[tokenForecast.input.forecastMethod] || tokenForecast.input.forecastMethod}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                Out: {METHOD_LABELS[tokenForecast.output.forecastMethod] || tokenForecast.output.forecastMethod}
                            </span>
                        </div>
                    )}
                </div>
                {trendChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
                        <AreaChart data={trendChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="tkInputGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="tkOutputGrad" x1="0" y1="0" x2="0" y2="1">
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
                            <Area type="monotone" dataKey="input" stroke="#6366f1" fill="url(#tkInputGrad)" strokeWidth={2} name="Input" />
                            <Area type="monotone" dataKey="output" stroke="#a78bfa" fill="url(#tkOutputGrad)" strokeWidth={2} name="Output" />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-[240px] flex items-center justify-center text-muted-foreground text-sm">No token data available yet.</div>
                )}
            </div>

            {/* ─── Token Forecast ─── */}
            {fcData.length > 0 && (
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
                    <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={fcData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="tkFcHistGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="tkFcHistOutGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="tkFcInputBandGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.12} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                                </linearGradient>
                                <linearGradient id="tkFcOutputBandGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.12} />
                                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} interval={Math.max(Math.floor(fcData.length / 12), 0)} />
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
                            <Area type="monotone" dataKey="inputLower" stackId="ciIn" stroke="none" fill="transparent" name="inputLower" connectNulls={false} />
                            <Area type="monotone" dataKey="inputBand" stackId="ciIn" stroke="none" fill="url(#tkFcInputBandGrad)" name="inputBand" connectNulls={false} />
                            <Area type="monotone" dataKey="outputLower" stackId="ciOut" stroke="none" fill="transparent" name="outputLower" connectNulls={false} />
                            <Area type="monotone" dataKey="outputBand" stackId="ciOut" stroke="none" fill="url(#tkFcOutputBandGrad)" name="outputBand" connectNulls={false} />
                            <Area type="monotone" dataKey="input" stroke="#6366f1" fill="url(#tkFcHistGrad)" strokeWidth={2} name="input" connectNulls={false} />
                            <Area type="monotone" dataKey="output" stroke="#a78bfa" fill="url(#tkFcHistOutGrad)" strokeWidth={1.5} name="output" connectNulls={false} />
                            <Area type="monotone" dataKey="inputFc" stroke="#6366f1" fill="none" strokeWidth={2} strokeDasharray="6 3" name="inputFc" connectNulls={false} />
                            <Area type="monotone" dataKey="outputFc" stroke="#a78bfa" fill="none" strokeWidth={2} strokeDasharray="6 3" name="outputFc" connectNulls={false} />
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
                                            <span>{METHOD_LABELS[b.method] || b.method}</span>
                                            <span className="opacity-60">WAPE {b.wape >= 0 ? `${b.wape}%` : 'N/A'}</span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Interactive DataTable */}
            <div className="card rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search workflows, models..."
                            value={globalFilter}
                            onChange={e => setGlobalFilter(e.target.value)}
                            className="pl-9 pr-4 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-72"
                        />
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {table.getFilteredRowModel().rows.length} of {rows.length} rows
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-secondary/50 text-muted-foreground text-xs font-medium border-b border-border">
                            {table.getHeaderGroups().map(hg => (
                                <tr key={hg.id}>
                                    {hg.headers.map(header => {
                                        const align = (header.column.columnDef.meta as any)?.align;
                                        return (
                                            <th
                                                key={header.id}
                                                className={`px-6 py-4 cursor-pointer select-none hover:text-foreground transition-colors ${align === 'right' ? 'text-right' : ''}`}
                                                onClick={header.column.getToggleSortingHandler()}
                                            >
                                                <span className="flex items-center gap-1.5 justify-between">
                                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                                    {header.column.getIsSorted() === 'asc' ? (
                                                        <ChevronUp size={14} />
                                                    ) : header.column.getIsSorted() === 'desc' ? (
                                                        <ChevronDown size={14} />
                                                    ) : (
                                                        <ChevronsUpDown size={14} className="opacity-30" />
                                                    )}
                                                </span>
                                            </th>
                                        );
                                    })}
                                </tr>
                            ))}
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {table.getRowModel().rows.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length} className="px-6 py-12 text-center text-muted-foreground">
                                        No token usage data found.
                                    </td>
                                </tr>
                            ) : (
                                table.getRowModel().rows.map(row => (
                                    <tr key={row.id} className="hover:bg-secondary/50 transition-colors duration-150">
                                        {row.getVisibleCells().map(cell => {
                                            const align = (cell.column.columnDef.meta as any)?.align;
                                            return (
                                                <td key={cell.id} className={`px-6 py-3 text-xs ${align === 'right' ? 'text-right' : ''}`}>
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
                    <div>
                        Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={table.getState().pagination.pageSize}
                            onChange={e => table.setPageSize(Number(e.target.value))}
                            className="bg-secondary border border-border rounded px-2 py-1 text-foreground text-xs"
                        >
                            {[10, 20, 50, 100].map(size => (
                                <option key={size} value={size}>{size} / page</option>
                            ))}
                        </select>
                        <button
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            aria-label="Previous page"
                            className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                            aria-label="Next page"
                            className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ label, value, subtitle, icon }: any) {
    return (
        <div className="card p-5 rounded-lg flex flex-col justify-between">
            <div className="flex justify-between items-start mb-2">
                <div className="text-xs text-muted-foreground">{label}</div>
                {icon}
            </div>
            <div className="text-3xl font-bold text-foreground">{value}</div>
            {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
        </div>
    );
}
