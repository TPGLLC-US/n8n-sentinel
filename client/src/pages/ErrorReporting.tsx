import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, Search, ExternalLink, ChevronDown, ChevronUp, ChevronsUpDown,
    ChevronLeft, ChevronRight, XCircle, Zap, Bot, TrendingUp, Filter, Loader2, CheckCircle2,
    Stethoscope, Eye, ShieldAlert, Coins, ThumbsUp, ThumbsDown, X, RefreshCw,
} from 'lucide-react';
import { authFetch } from '../lib/auth';
import { safeHref } from '../lib/safe-href';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    flexRender,
    createColumnHelper,
    type SortingState,
} from '@tanstack/react-table';

interface ErrorRow {
    id: string;
    remote_execution_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    error_message: string | null;
    error_node: string | null;
    workflow_name: string;
    workflow_remote_id: string;
    node_count: number | null;
    instance_id: string;
    instance_name: string;
    base_url: string | null;
    has_api_key: boolean;
    ai_fix_status: string | null;
    diagnosis_feedback_rating: 'up' | 'down' | null;
    ai_diagnosis: {
        diagnosis: string;
        cause: string;
        resolution: string;
        category: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        fixable: boolean;
        token_usage?: { input_tokens: number; output_tokens: number };
    } | null;
}

interface ErrorStats {
    errors_24h: number;
    errors_7d: number;
    unique_failing_workflows_24h: number;
    error_rate_24h: number;
    total_executions_24h: number;
    top_failing_workflows: { workflow_name: string; remote_id: string; instance_name: string; instance_id: string; error_count: number }[];
    top_failing_nodes: { error_node: string; error_count: number }[];
    diagnosis_stats: { diagnosed: number; diagnosed_24h: number; thumbs_up: number; thumbs_down: number };
}

function formatDuration(ms: number | null): string {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function AIFixBadge({ status }: { status: string | null }) {
    if (!status) return <span className="text-[10px] text-muted-foreground/40">—</span>;
    const styles: Record<string, string> = {
        pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        in_progress: 'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse',
        success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        failed: 'bg-red-500/10 text-red-400 border-red-500/20',
        rejected: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${styles[status] || styles.pending}`}>
            <Bot size={10} /> {status}
        </span>
    );
}

function StatCard({ label, value, sub, icon, color = 'text-foreground' }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; color?: string }) {
    return (
        <div className="card rounded-lg p-5 flex items-start gap-4">
            <div className={`${color}`}>{icon}</div>
            <div>
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
            </div>
        </div>
    );
}

const columnHelper = createColumnHelper<ErrorRow>();

export default function ErrorReporting() {
    const [errors, setErrors] = useState<ErrorRow[]>([]);
    const [stats, setStats] = useState<ErrorStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'started_at', desc: true }]);
    const [globalFilter, setGlobalFilter] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [instanceFilter, setInstanceFilter] = useState('all');

    const handleDiagnosisUpdate = (id: string, diag: ErrorRow['ai_diagnosis']) => {
        setErrors(prev => prev.map(e => e.id === id ? { ...e, ai_diagnosis: diag } : e));
    };

    const handleErrorUpdate = (id: string, fields: Partial<ErrorRow>) => {
        setErrors(prev => prev.map(e => e.id === id ? { ...e, ...fields } : e));
    };

    const fetchData = () => {
        Promise.all([
            authFetch('/errors?limit=500').then(r => r.json()),
            authFetch('/errors/stats').then(r => r.json()),
        ])
            .then(([errData, statsData]) => {
                setErrors(errData.errors || []);
                setStats(statsData);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000); // refresh every 30s
        return () => clearInterval(interval);
    }, []);

    const instances = useMemo(() => {
        const map = new Map<string, string>();
        for (const e of errors) map.set(e.instance_id, e.instance_name);
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    }, [errors]);

    const filtered = useMemo(() => {
        if (instanceFilter === 'all') return errors;
        return errors.filter(e => e.instance_id === instanceFilter);
    }, [errors, instanceFilter]);

    const columns = useMemo(() => [
        columnHelper.accessor('workflow_name', {
            header: 'Workflow',
            cell: info => {
                const row = info.row.original;
                return (
                    <div className="flex items-center gap-2">
                        <span className="text-foreground font-medium text-sm truncate max-w-[200px] block" title={info.getValue()}>
                            {info.getValue() || 'Unknown'}
                        </span>
                        {row.base_url && row.workflow_remote_id && (
                            <a
                                href={safeHref(row.base_url) !== '#' ? `${row.base_url}/workflow/${row.workflow_remote_id}` : '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
                                title="Open in n8n"
                                onClick={e => e.stopPropagation()}
                            >
                                <ExternalLink size={12} />
                            </a>
                        )}
                    </div>
                );
            },
        }),
        columnHelper.accessor('error_node', {
            header: 'Failed Node',
            cell: info => (
                <span className="text-red-400/80 text-xs font-mono truncate max-w-[150px] block" title={info.getValue() || ''}>
                    {info.getValue() || '—'}
                </span>
            ),
        }),
        columnHelper.accessor('error_message', {
            header: 'Error',
            cell: info => (
                <span className="text-muted-foreground text-xs truncate max-w-[280px] block" title={info.getValue() || ''}>
                    {info.getValue() || 'No error message'}
                </span>
            ),
        }),
        columnHelper.accessor('instance_name', {
            header: 'Instance',
            cell: info => <span className="text-muted-foreground text-xs">{info.getValue()}</span>,
        }),
        columnHelper.accessor('started_at', {
            header: 'When',
            cell: info => (
                <span className="text-muted-foreground text-xs" title={new Date(info.getValue()).toLocaleString()}>
                    {timeAgo(info.getValue())}
                </span>
            ),
            sortingFn: 'datetime',
        }),
        columnHelper.accessor('duration_ms', {
            header: 'Duration',
            cell: info => <span className="text-muted-foreground font-mono text-xs">{formatDuration(info.getValue())}</span>,
            meta: { align: 'right' },
        }),
        columnHelper.accessor('ai_fix_status', {
            header: 'AI Status',
            cell: info => {
                const row = info.row.original;
                return (
                    <div className="flex items-center gap-1.5 justify-center">
                        {row.ai_diagnosis && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium border bg-violet-500/10 text-violet-400 border-violet-500/20" title="Diagnosed">
                                <Stethoscope size={9} />
                            </span>
                        )}
                        <AIFixBadge status={info.getValue()} />
                    </div>
                );
            },
            meta: { align: 'center' },
        }),
    ], []);

    const table = useReactTable({
        data: filtered,
        columns,
        state: { sorting, globalFilter },
        onSortingChange: setSorting,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: { pagination: { pageSize: 25 } },
    });

    if (loading) return <div className="p-8 text-muted-foreground animate-pulse">Loading error data...</div>;

    return (
        <div className="space-y-8">
            {/* Header */}
            <h1 className="text-2xl font-semibold text-foreground">Error Reporting</h1>

            {/* Stats Cards */}
            {stats && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        icon={<XCircle size={20} />}
                        label="Errors (24h)"
                        value={stats.errors_24h}
                        sub={`${stats.error_rate_24h}% error rate`}
                        color="text-red-400"
                    />
                    <StatCard
                        icon={<TrendingUp size={20} />}
                        label="Errors (7d)"
                        value={stats.errors_7d}
                        color="text-amber-400"
                    />
                    <StatCard
                        icon={<Zap size={20} />}
                        label="Failing Workflows (24h)"
                        value={stats.unique_failing_workflows_24h}
                        sub={`of ${stats.total_executions_24h} total executions`}
                        color="text-orange-400"
                    />
                    <StatCard
                        icon={<Stethoscope size={20} />}
                        label="Diagnosed"
                        value={stats.diagnosis_stats.diagnosed}
                        sub={stats.diagnosis_stats.diagnosed_24h > 0 ? `${stats.diagnosis_stats.diagnosed_24h} in last 24h` : `${stats.diagnosis_stats.thumbs_up}↑ ${stats.diagnosis_stats.thumbs_down}↓ feedback`}
                        color="text-violet-400"
                    />
                </div>
            )}

            {/* Top Failing Section */}
            {stats && (stats.top_failing_workflows.length > 0 || stats.top_failing_nodes.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {stats.top_failing_workflows.length > 0 && (
                        <div className="card rounded-lg p-5">
                            <h3 className="text-sm font-medium text-foreground mb-3">
                                Top Failing Workflows (7d)
                            </h3>
                            <div className="space-y-2">
                                {stats.top_failing_workflows.map((wf, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2 truncate">
                                            <span className="text-foreground font-medium truncate max-w-[200px]">{wf.workflow_name}</span>
                                            <span className="text-muted-foreground/50">{wf.instance_name}</span>
                                        </div>
                                        <span className="text-red-400 font-mono font-bold shrink-0">{wf.error_count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {stats.top_failing_nodes.length > 0 && (
                        <div className="card rounded-lg p-5">
                            <h3 className="text-sm font-medium text-foreground mb-3">
                                Top Failing Nodes (7d)
                            </h3>
                            <div className="space-y-2">
                                {stats.top_failing_nodes.map((node, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <span className="text-foreground font-mono">{node.error_node}</span>
                                        <span className="text-amber-400 font-mono font-bold">{node.error_count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-3">
                {instances.length > 1 && (
                    <div className="flex items-center gap-2">
                        <Filter size={14} className="text-muted-foreground" />
                        <select
                            value={instanceFilter}
                            onChange={e => setInstanceFilter(e.target.value)}
                            className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-xs text-foreground"
                        >
                            <option value="all">All Instances</option>
                            {instances.map(inst => (
                                <option key={inst.id} value={inst.id}>{inst.name}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* Error Table */}
            <div className="card rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search errors..."
                            value={globalFilter}
                            onChange={e => setGlobalFilter(e.target.value)}
                            className="pl-9 pr-4 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-72"
                        />
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {table.getFilteredRowModel().rows.length} errors
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
                                                className={`px-6 py-4 ${header.column.getCanSort() ? 'cursor-pointer select-none hover:text-foreground transition-colors' : ''} ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''}`}
                                                onClick={header.column.getToggleSortingHandler()}
                                            >
                                                <span className={`flex items-center gap-1.5 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-between'}`}>
                                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                                    {header.column.getCanSort() && (
                                                        header.column.getIsSorted() === 'asc' ? <ChevronUp size={14} /> :
                                                        header.column.getIsSorted() === 'desc' ? <ChevronDown size={14} /> :
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
                                    <td colSpan={columns.length} className="px-6 py-12 text-center text-muted-foreground text-sm">
                                        No errors found.
                                    </td>
                                </tr>
                            ) : (
                                table.getRowModel().rows.map(row => {
                                    const isExpanded = expandedId === row.original.id;
                                    return (
                                        <tr key={row.id} className="group">
                                            <td colSpan={columns.length} className="p-0">
                                                <div
                                                    className={`flex items-center cursor-pointer transition-colors duration-150 ${isExpanded ? 'bg-secondary' : 'hover:bg-secondary/50'}`}
                                                    onClick={() => setExpandedId(isExpanded ? null : row.original.id)}
                                                >
                                                    {row.getVisibleCells().map(cell => {
                                                        const align = (cell.column.columnDef.meta as any)?.align;
                                                        return (
                                                            <div key={cell.id} className={`px-6 py-3 ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''}`} style={{ width: cell.column.getSize(), flex: `${cell.column.getSize()} 0 auto` }}>
                                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {isExpanded && <ExpandedError error={row.original} onDiagnosisUpdate={handleDiagnosisUpdate} onErrorUpdate={handleErrorUpdate} />}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
                    <div>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}</div>
                    <div className="flex items-center gap-2">
                        <select
                            value={table.getState().pagination.pageSize}
                            onChange={e => table.setPageSize(Number(e.target.value))}
                            className="bg-secondary border border-border rounded px-2 py-1 text-foreground text-xs"
                        >
                            {[10, 25, 50, 100].map(size => (
                                <option key={size} value={size}>{size} / page</option>
                            ))}
                        </select>
                        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150">
                            <ChevronLeft size={16} />
                        </button>
                        <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150">
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

const SEVERITY_STYLES: Record<string, string> = {
    critical: 'bg-red-500/10 text-red-400 border-red-500/20',
    high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

const CATEGORY_LABELS: Record<string, string> = {
    code_node_error: 'Code Node',
    expression_error: 'Expression',
    missing_config: 'Missing Config',
    type_mismatch: 'Type Mismatch',
    null_reference: 'Null Reference',
    api_error: 'API Error',
    credential_error: 'Credentials',
    rate_limit: 'Rate Limit',
    network_error: 'Network',
    data_format: 'Data Format',
    unknown: 'Unknown',
};

/** Hook: cycle through step labels while an async action is running */
function useProgressSteps(steps: string[], intervalMs = 4000): [string, () => void, () => void] {
    const [index, setIndex] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const start = useCallback(() => {
        setIndex(0);
        timerRef.current = setInterval(() => {
            setIndex(prev => prev < steps.length - 1 ? prev + 1 : prev);
        }, intervalMs);
    }, [steps.length, intervalMs]);
    const stop = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setIndex(0);
    }, []);
    useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);
    return [steps[index], start, stop];
}

const DIAGNOSE_STEPS = ['Fetching workflow...', 'Analyzing error...', 'Inspecting nodes...', 'Building diagnosis...', 'Finalizing...'];
const FIX_STEPS = ['Loading diagnosis...', 'Fetching workflow...', 'Inspecting nodes...', 'Generating fix...', 'Applying fix...'];

function DiagnosisPanel({ diagnosis, errorId, initialRating }: { diagnosis: ErrorRow['ai_diagnosis']; errorId: string; initialRating?: 'up' | 'down' | null }) {
    const [feedbackSent, setFeedbackSent] = useState<'up' | 'down' | null>(initialRating ?? null);
    const [showCommentModal, setShowCommentModal] = useState(false);
    const [pendingRating, setPendingRating] = useState<'up' | 'down' | null>(null);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const commentRef = useRef<HTMLTextAreaElement>(null);

    if (!diagnosis) return null;

    const handleFeedback = (rating: 'up' | 'down') => {
        if (feedbackSent) return;
        setPendingRating(rating);
        if (rating === 'down') {
            setShowCommentModal(true);
            setTimeout(() => commentRef.current?.focus(), 100);
        } else {
            submitFeedback(rating, '');
        }
    };

    const submitFeedback = async (rating: 'up' | 'down', feedbackComment: string) => {
        setSubmitting(true);
        try {
            await authFetch(`/errors/${errorId}/diagnosis-feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating, comment: feedbackComment || undefined }),
            });
            setFeedbackSent(rating);
            setShowCommentModal(false);
            setComment('');
        } catch (err) {
            console.error('Failed to submit feedback:', err);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="rounded-lg border border-border overflow-hidden relative">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-secondary/50">
                <Stethoscope size={14} className="text-violet-400" />
                <span className="text-xs font-semibold text-foreground">AI Diagnosis</span>
                <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${SEVERITY_STYLES[diagnosis.severity] || SEVERITY_STYLES.medium}`}>
                    <ShieldAlert size={10} /> {diagnosis.severity}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-secondary text-muted-foreground border border-border">
                    {CATEGORY_LABELS[diagnosis.category] || diagnosis.category}
                </span>
                {diagnosis.fixable && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <Bot size={10} /> AI Fixable
                    </span>
                )}
            </div>
            <div className="p-4 space-y-3">
                <div>
                    <div className="text-[11px] text-muted-foreground mb-1">Diagnosis</div>
                    <div className="text-sm text-foreground/90">{diagnosis.diagnosis}</div>
                </div>
                <div>
                    <div className="text-[11px] text-muted-foreground mb-1">Root Cause</div>
                    <div className="text-sm text-amber-400/80">{diagnosis.cause}</div>
                </div>
                <div>
                    <div className="text-[11px] text-muted-foreground mb-1">Resolution</div>
                    <div className="text-sm text-emerald-400/80 whitespace-pre-wrap">{diagnosis.resolution}</div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border">
                    {diagnosis.token_usage && (
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                            <Coins size={10} />
                            <span>Input: <span className="font-mono text-muted-foreground/70">{diagnosis.token_usage.input_tokens.toLocaleString()}</span></span>
                            <span>Output: <span className="font-mono text-muted-foreground/70">{diagnosis.token_usage.output_tokens.toLocaleString()}</span></span>
                        </div>
                    )}
                    {!diagnosis.token_usage && <div />}
                    <div className="flex items-center gap-1">
                        {feedbackSent ? (
                            <span className="text-[10px] text-white/70">
                                {feedbackSent === 'up' ? 'Thanks for the feedback!' : 'Feedback recorded'}
                            </span>
                        ) : (
                            <>
                                <span className="text-[10px] text-white/70 mr-1">Helpful?</span>
                                <button
                                    onClick={() => handleFeedback('up')}
                                    className="p-1 rounded hover:bg-emerald-500/10 text-white/60 hover:text-emerald-400 transition-colors"
                                    title="Good diagnosis"
                                >
                                    <ThumbsUp size={12} />
                                </button>
                                <button
                                    onClick={() => handleFeedback('down')}
                                    className="p-1 rounded hover:bg-red-500/10 text-white/60 hover:text-red-400 transition-colors"
                                    title="Poor diagnosis"
                                >
                                    <ThumbsDown size={12} />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Comment modal for thumbs down */}
            {showCommentModal && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
                    <div className="bg-secondary border border-border rounded-lg p-4 w-[90%] max-w-md shadow-lg">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-medium text-foreground">What was wrong?</span>
                            <button
                                onClick={() => { setShowCommentModal(false); setPendingRating(null); }}
                                className="p-1 rounded hover:bg-accent text-muted-foreground"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <textarea
                            ref={commentRef}
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder="Incorrect diagnosis, wrong root cause, unhelpful resolution..."
                            className="w-full h-20 rounded-md border border-border bg-background text-sm text-foreground p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                        />
                        <div className="flex items-center justify-end gap-2 mt-3">
                            <button
                                onClick={() => { setShowCommentModal(false); setPendingRating(null); }}
                                className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:bg-accent transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => pendingRating && submitFeedback(pendingRating, comment)}
                                disabled={submitting}
                                className="px-3 py-1.5 text-xs rounded-md bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                            >
                                {submitting ? 'Submitting...' : 'Submit Feedback'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ExpandedError({ error, onDiagnosisUpdate, onErrorUpdate }: { error: ErrorRow; onDiagnosisUpdate: (id: string, diag: ErrorRow['ai_diagnosis']) => void; onErrorUpdate: (id: string, fields: Partial<ErrorRow>) => void }) {
    const [diagnosing, setDiagnosing] = useState<'simple' | 'complex' | null>(null);
    const [diagError, setDiagError] = useState<string | null>(null);
    const [enriching, setEnriching] = useState(false);
    const [enrichReason, setEnrichReason] = useState<string | null>(null);
    const [fixing, setFixing] = useState(false);
    const [fixResult, setFixResult] = useState<{ status: string; diagnosis: string; fixDescription: string | null; error?: string; token_usage?: { input_tokens: number; output_tokens: number } } | null>(null);
    const [diagStep, startDiagSteps, stopDiagSteps] = useProgressSteps(DIAGNOSE_STEPS);
    const [fixStep, startFixSteps, stopFixSteps] = useProgressSteps(FIX_STEPS);

    // Auto-enrich: if error_message or error_node is missing, fetch from n8n
    useEffect(() => {
        if (error.error_message && error.error_node) return;
        let cancelled = false;
        setEnriching(true);
        setEnrichReason(null);
        authFetch(`/errors/${error.id}/enrich`, { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                if (cancelled) return;
                if (data.reason) setEnrichReason(data.reason);
                const updates: Partial<ErrorRow> = {};
                if (data.error_message && !error.error_message) updates.error_message = data.error_message;
                if (data.error_node && !error.error_node) updates.error_node = data.error_node;
                if (Object.keys(updates).length > 0) onErrorUpdate(error.id, updates);
            })
            .catch(() => { if (!cancelled) setEnrichReason('network_error'); })
            .finally(() => { if (!cancelled) setEnriching(false); });
        return () => { cancelled = true; };
    }, [error.id]);

    const n8nWorkflowUrl = error.base_url && error.workflow_remote_id && safeHref(error.base_url) !== '#'
        ? `${error.base_url}/workflow/${error.workflow_remote_id}`
        : null;

    const n8nExecutionUrl = error.base_url && error.workflow_remote_id && error.remote_execution_id && safeHref(error.base_url) !== '#'
        ? `${error.base_url}/workflow/${error.workflow_remote_id}/executions/${error.remote_execution_id}`
        : null;

    const simpleTooltip = 'Quick single-shot diagnosis based on error message only (~1K tokens)';
    const complexTooltip = `Deep agentic diagnosis — inspects actual node configs and execution data (2-5 turns, ${error.node_count ?? '?'} nodes)`;

    const handleDiagnose = async (mode: 'simple' | 'complex', force = false) => {
        setDiagnosing(mode);
        setDiagError(null);
        if (mode === 'complex') startDiagSteps();
        try {
            const res = await authFetch(`/errors/${error.id}/diagnose`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode, force }),
            });
            const data = await res.json();
            if (!res.ok) {
                setDiagError(data.error || 'Diagnosis failed');
            } else {
                onDiagnosisUpdate(error.id, data);
            }
        } catch (err: any) {
            setDiagError(err.message);
        } finally {
            if (mode === 'complex') stopDiagSteps();
            setDiagnosing(null);
        }
    };

    const handleFix = async () => {
        setFixing(true);
        setFixResult(null);
        startFixSteps();
        try {
            const res = await authFetch(`/errors/${error.id}/fix`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                setFixResult({ status: 'failed', diagnosis: '', fixDescription: null, error: data.error || 'Fix failed' });
            } else {
                setFixResult(data);
                onErrorUpdate(error.id, { ai_fix_status: data.status });
            }
        } catch (err: any) {
            setFixResult({ status: 'failed', diagnosis: '', fixDescription: null, error: err.message });
        } finally {
            stopFixSteps();
            setFixing(false);
        }
    };


    return (
        <div className="px-6 py-4 bg-secondary/30 border-t border-border space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <div className="text-[11px] text-muted-foreground mb-1">Error Message</div>
                    <div className="text-sm text-red-400/90 bg-red-500/5 border border-red-500/10 rounded-lg p-3 font-mono text-xs whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                        {error.error_message || (enriching
                            ? <span className="flex items-center gap-1.5 text-muted-foreground animate-pulse"><Loader2 size={12} className="animate-spin" /> Fetching error details from n8n...</span>
                            : 'No error message available'
                        )}
                    </div>
                    {!error.error_message && !enriching && enrichReason && (
                        <div className="mt-1.5 text-[11px] text-muted-foreground/70">
                            {enrichReason === 'no_api_key' && (
                                <span>Add an <a href={`/instances/${error.instance_id}`} className="text-primary underline underline-offset-2">n8n API key</a> for this instance to auto-fetch error details.</span>
                            )}
                            {enrichReason === 'no_base_url' && <span>Instance has no base URL configured.</span>}
                            {enrichReason === 'n8n_api_failed' && <span>Could not fetch from n8n API — the execution may have been pruned.</span>}
                            {enrichReason === 'no_error_in_n8n' && <span>n8n execution data does not contain error details.</span>}
                            {enrichReason === 'fetch_error' && <span>Failed to reach n8n instance.</span>}
                            {enrichReason === 'network_error' && <span>Network error contacting Sentinel server.</span>}
                        </div>
                    )}
                </div>
                <div className="space-y-3">
                    <div>
                        <div className="text-[11px] text-muted-foreground mb-1">Details</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="text-muted-foreground">Execution ID</div>
                            <div className="font-mono text-foreground">{error.remote_execution_id || '—'}</div>
                            <div className="text-muted-foreground">Failed Node</div>
                            <div className="font-mono text-red-400">{error.error_node || '—'}</div>
                            <div className="text-muted-foreground">Workflow</div>
                            <div className="text-foreground">{error.workflow_name}</div>
                            <div className="text-muted-foreground">Instance</div>
                            <div className="text-foreground">{error.instance_name}</div>
                            <div className="text-muted-foreground">Time</div>
                            <div className="text-foreground">{new Date(error.started_at).toLocaleString()}</div>
                            <div className="text-muted-foreground">Duration</div>
                            <div className="font-mono text-foreground">{formatDuration(error.duration_ms)}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* AI Diagnosis */}
            {error.ai_diagnosis && <DiagnosisPanel diagnosis={error.ai_diagnosis} errorId={error.id} initialRating={error.diagnosis_feedback_rating} />}

            {/* Diagnosis error */}
            {diagError && (
                <div className="rounded-lg p-3 text-xs border bg-red-500/5 border-red-500/10 text-red-400">
                    <div className="flex items-center gap-1.5 font-medium"><XCircle size={12} /> Diagnosis failed</div>
                    <div className="mt-1 opacity-80">{diagError}</div>
                </div>
            )}

            {/* AI Fix Result */}
            {fixResult && (
                <div className={`rounded-lg p-3 text-xs border ${
                    fixResult.status === 'success' ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' :
                    fixResult.status === 'rejected' ? 'bg-amber-500/5 border-amber-500/10 text-amber-400' :
                    'bg-red-500/5 border-red-500/10 text-red-400'
                }`}>
                    <div className="flex items-center gap-1.5 font-medium mb-1">
                        {fixResult.status === 'success' ? <CheckCircle2 size={12} /> :
                         fixResult.status === 'rejected' ? <AlertTriangle size={12} /> :
                         <XCircle size={12} />}
                        {fixResult.status === 'success' ? 'Fix Applied Successfully' :
                         fixResult.status === 'rejected' ? 'Not Fixable via AI' :
                         'Fix Failed'}
                    </div>
                    {fixResult.error && <div className="text-red-400/80">{fixResult.error}</div>}
                    {fixResult.diagnosis && <div className="mt-1 opacity-80">{fixResult.diagnosis}</div>}
                    {fixResult.fixDescription && <div className="mt-1 opacity-60">{fixResult.fixDescription}</div>}
                    {fixResult.token_usage && (
                        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
                            <Coins size={10} />
                            <span>Input: <span className="font-mono">{fixResult.token_usage.input_tokens.toLocaleString()}</span></span>
                            <span>Output: <span className="font-mono">{fixResult.token_usage.output_tokens.toLocaleString()}</span></span>
                        </div>
                    )}
                </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-border">
                {n8nExecutionUrl && (
                    <a
                        href={n8nExecutionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-muted-foreground border border-border hover:bg-accent hover:text-foreground transition-colors duration-150"
                    >
                        <Eye size={12} /> View Execution
                    </a>
                )}
                {n8nWorkflowUrl && (
                    <a
                        href={n8nWorkflowUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-muted-foreground border border-border hover:bg-accent hover:text-foreground transition-colors duration-150"
                    >
                        <ExternalLink size={12} /> Open Workflow
                    </a>
                )}
                {!error.ai_diagnosis ? (
                    <>
                        <button
                            onClick={() => handleDiagnose('simple', false)}
                            disabled={!!diagnosing}
                            title={simpleTooltip}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors duration-150 disabled:cursor-wait ${diagnosing === 'simple' ? 'bg-violet-500 text-white border-violet-500' : 'bg-violet-500/10 text-violet-400 border-violet-500/20 hover:bg-violet-500/20 disabled:opacity-50'}`}
                        >
                            {diagnosing === 'simple' ? <Loader2 size={12} className="animate-spin" /> : <Stethoscope size={12} />}
                            {diagnosing === 'simple' ? 'Diagnosing...' : 'Simple Diagnose'}
                        </button>
                        <button
                            onClick={() => handleDiagnose('complex', false)}
                            disabled={!!diagnosing}
                            title={complexTooltip}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors duration-150 disabled:cursor-wait ${diagnosing === 'complex' ? 'bg-blue-500 text-white border-blue-500' : 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20 disabled:opacity-50'}`}
                        >
                            {diagnosing === 'complex' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                            {diagnosing === 'complex' ? diagStep : 'Deep Diagnose'}
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={() => handleDiagnose('simple', true)}
                            disabled={!!diagnosing}
                            title="Re-run with simple single-shot diagnosis"
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors duration-150 disabled:cursor-wait ${diagnosing === 'simple' ? 'bg-violet-500 text-white border-violet-500' : 'bg-violet-500/10 text-violet-400/60 border-violet-500/10 hover:border-violet-500/20 hover:text-violet-400 hover:bg-violet-500/20 disabled:opacity-50'}`}
                        >
                            {diagnosing === 'simple' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={11} />}
                            {diagnosing === 'simple' ? 'Re-diagnosing...' : 'Re-run Simple'}
                        </button>
                        <button
                            onClick={() => handleDiagnose('complex', true)}
                            disabled={!!diagnosing}
                            title="Re-run with deep agentic diagnosis"
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors duration-150 disabled:cursor-wait ${diagnosing === 'complex' ? 'bg-blue-500 text-white border-blue-500' : 'bg-blue-500/10 text-blue-400/60 border-blue-500/10 hover:border-blue-500/20 hover:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50'}`}
                        >
                            {diagnosing === 'complex' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={11} />}
                            {diagnosing === 'complex' ? diagStep : 'Re-run Deep'}
                        </button>
                    </>
                )}
                {error.ai_diagnosis?.fixable !== false && (
                    <button
                        onClick={handleFix}
                        disabled={fixing || !error.ai_diagnosis}
                        title={error.ai_diagnosis ? 'Agentic fix: uses diagnosis to target specific nodes (2-5 turns)' : 'Run diagnosis first — AI Fix requires a prior diagnosis'}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors duration-150 disabled:opacity-50 ${
                            fixing
                                ? 'bg-primary text-white border-primary disabled:cursor-wait disabled:opacity-100'
                                : error.ai_diagnosis
                                    ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 disabled:cursor-wait'
                                    : 'bg-secondary text-muted-foreground border-border cursor-not-allowed'
                        }`}
                    >
                        {fixing ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
                        {fixing ? fixStep : error.ai_diagnosis ? 'Fix with AI' : 'Run Diagnosis First'}
                    </button>
                )}
            </div>
        </div>
    );
}
