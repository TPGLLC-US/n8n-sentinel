import { useEffect, useMemo, useState } from 'react';
import {
    Search,
    ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight,
    CheckCircle2, XCircle, CircleDot,
} from 'lucide-react';
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
} from '@tanstack/react-table';

interface ExecutionRow {
    id: string;
    remote_execution_id: string;
    workflow_name: string;
    instance_name: string;
    status: string;
    started_at: string;
    duration_ms: number | null;
    ai_diagnosis: any | null;
}

const STATUS_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'success', label: 'Success', icon: CheckCircle2, color: 'text-emerald-400' },
    { key: 'error', label: 'Error', icon: XCircle, color: 'text-red-400' },
    { key: 'running', label: 'Running', icon: CircleDot, color: 'text-blue-400' },
];

function StatusBadge({ status }: { status: string }) {
    if (status === 'success') {
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Success</span>;
    }
    if (status === 'error') {
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">Error</span>;
    }
    if (status === 'running') {
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse">Running</span>;
    }
    return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-secondary text-muted-foreground border border-border">{status}</span>;
}

function formatDuration(ms: number | null): string {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

const columnHelper = createColumnHelper<ExecutionRow>();

export default function Executions() {
    const [executions, setExecutions] = useState<ExecutionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'started_at', desc: true }]);
    const [globalFilter, setGlobalFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    useEffect(() => {
        authFetch('/executions')
            .then(res => res.json())
            .then(data => setExecutions(data.executions || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const filtered = useMemo(() => {
        if (statusFilter === 'all') return executions;
        return executions.filter(e => e.status === statusFilter);
    }, [executions, statusFilter]);

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { all: executions.length };
        for (const e of executions) {
            counts[e.status] = (counts[e.status] || 0) + 1;
        }
        return counts;
    }, [executions]);

    const columns = useMemo(() => [
        columnHelper.accessor('remote_execution_id', {
            header: 'ID',
            cell: info => (
                <span className="font-mono text-xs text-muted-foreground">{info.getValue()}</span>
            ),
        }),
        columnHelper.accessor('workflow_name', {
            header: 'Workflow',
            cell: info => {
                const row = info.row.original;
                const isSentinel = !!row.ai_diagnosis;
                const name = info.getValue() || 'Unknown';
                return (
                    <span className={`font-medium text-sm truncate max-w-[240px] block ${isSentinel ? 'text-violet-400' : 'text-foreground'}`} title={isSentinel ? `Sentinel - ${name}` : name}>
                        {isSentinel && <span className="text-violet-400/70">Sentinel - </span>}{name}
                    </span>
                );
            },
        }),
        columnHelper.accessor('instance_name', {
            header: 'Instance',
            cell: info => <span className="text-muted-foreground text-xs">{info.getValue() || 'Unknown'}</span>,
        }),
        columnHelper.accessor('status', {
            header: 'Status',
            cell: info => <StatusBadge status={info.getValue()} />,
            meta: { align: 'center' },
        }),
        columnHelper.accessor('started_at', {
            header: 'Started At',
            cell: info => (
                <span className="text-muted-foreground text-xs">
                    {new Date(info.getValue()).toLocaleString()}
                </span>
            ),
            sortingFn: 'datetime',
        }),
        columnHelper.accessor('duration_ms', {
            header: 'Duration',
            cell: info => (
                <span className="text-muted-foreground font-mono text-xs">
                    {formatDuration(info.getValue())}
                </span>
            ),
            meta: { align: 'right' },
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

    if (loading) return <div className="p-8 text-muted-foreground animate-pulse">Loading executions...</div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-2xl font-semibold text-foreground mb-6">Executions</h1>
            </div>

            {/* Status filter tabs */}
            <div className="flex gap-2 mb-6">
                {STATUS_FILTERS.map(f => {
                    const count = statusCounts[f.key] || 0;
                    const active = statusFilter === f.key;
                    const Icon = f.icon;
                    return (
                        <button
                            key={f.key}
                            onClick={() => setStatusFilter(f.key)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 border flex items-center gap-2 ${
                            statusFilter === f.key
                                ? 'bg-accent text-foreground border-border'
                                : 'text-muted-foreground border-transparent hover:text-foreground'
                        }`}
                        >
                            {Icon && <Icon size={14} className={active ? f.color : ''} />}
                            {f.label}
                            <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-secondary' : 'bg-secondary/50'}`}>
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="card rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search executions..."
                            value={globalFilter}
                            onChange={e => setGlobalFilter(e.target.value)}
                            className="pl-9 pr-4 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-72"
                        />
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {table.getFilteredRowModel().rows.length} of {filtered.length} executions
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
                                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground text-sm">
                                        No executions found.
                                    </td>
                                </tr>
                            ) : (
                                table.getRowModel().rows.map(row => (
                                    <tr key={row.id} className="border-b border-border hover:bg-secondary/50 transition-colors duration-150">
                                        {row.getVisibleCells().map(cell => {
                                            const align = (cell.column.columnDef.meta as any)?.align;
                                            return (
                                                <td key={cell.id} className={`px-6 py-3 ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''}`}>
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
