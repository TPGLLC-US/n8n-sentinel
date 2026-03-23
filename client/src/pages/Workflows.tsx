import { useEffect, useMemo, useState } from 'react';
import {
    FileJson, Search, Cpu, Globe, FileSpreadsheet, KeyRound,
    Database, Mail, HardDrive, Webhook, MessageSquare, CalendarDays, Share2,
    FormInput, MessageCircle,
    ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight,
    CheckCircle2, XCircle,
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

interface WorkflowRow {
    id: string;
    instance_id: string;
    name: string;
    instance_name: string;
    node_count: number;
    is_active: boolean;
    resources: any[] | null;
}

const TYPE_BADGE_CONFIG: Record<string, { label: string; color: string; icon: any; iconOnly?: boolean }> = {
    ai_model: { label: 'AI Model', color: 'bg-violet-500/10 text-violet-400 border-violet-500/20', icon: Cpu },
    ai_embedding: { label: 'Embedding', color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', icon: Cpu },
    api_domain: { label: 'API', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: Globe },
    google_doc: { label: 'Doc', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: Database },
    google_sheet: { label: 'Sheet', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: FileSpreadsheet },
    google_slide: { label: 'Slide', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: FileSpreadsheet },
    google_drive: { label: 'Drive', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: Database },
    database: { label: 'Database', color: 'bg-teal-500/10 text-teal-400 border-teal-500/20', icon: HardDrive },
    webhook: { label: 'Webhook', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20', icon: Webhook },
    form_trigger: { label: 'Form', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20', icon: FormInput },
    chat_trigger: { label: 'Chat', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20', icon: MessageCircle },
    messaging: { label: 'Messaging', color: 'bg-sky-500/10 text-sky-400 border-sky-500/20', icon: MessageSquare },
    calendar: { label: 'Calendar', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20', icon: CalendarDays },
    social: { label: 'Social', color: 'bg-pink-500/10 text-pink-400 border-pink-500/20', icon: Share2 },
    gmail: { label: 'Gmail', color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: Mail },
    credential: { label: 'Credential', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: KeyRound, iconOnly: true },
};

function ResourceBadges({ resources }: { resources: any[] | null }) {
    if (!resources || resources.length === 0) {
        return <span className="text-muted-foreground/30 text-xs">-</span>;
    }

    const grouped: Record<string, string[]> = {};
    for (const r of resources) {
        const type = r.type || 'unknown';
        if (!grouped[type]) grouped[type] = [];
        const displayName = type === 'credential'
            ? (r.credential_name || r.node_name || r.identifier)
            : (r.identifier || r.node_name);
        if (displayName) grouped[type].push(displayName);
    }

    return (
        <div className="flex flex-wrap gap-1.5">
            {Object.entries(grouped).map(([type, identifiers]) => {
                const config = TYPE_BADGE_CONFIG[type];
                const Icon = config?.icon || Database;
                const label = config?.label || type.replace(/_/g, ' ');
                const color = config?.color || 'bg-white/5 text-muted-foreground border-white/10';
                const iconOnly = config?.iconOnly;
                const count = identifiers.length;
                return (
                    <span key={type} className="relative group/badge">
                        <span className={`inline-flex items-center gap-1 ${iconOnly ? 'px-1.5' : 'px-2'} py-0.5 rounded-md border text-[10px] font-medium cursor-default ${color}`}>
                            <Icon size={10} />
                            {!iconOnly && label}
                            {count > 1 && <span className="opacity-70">x{count}</span>}
                        </span>
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 bg-card border border-border rounded-md shadow-md px-3 py-2 opacity-0 invisible group-hover/badge:opacity-100 group-hover/badge:visible transition-all z-20 min-w-[140px] max-w-[280px] pointer-events-none">
                            <div className="text-[11px] text-muted-foreground font-medium mb-1">{label}{count > 1 ? ` (${count})` : ''}</div>
                            <div className="flex flex-col gap-0.5 max-h-[150px] overflow-y-auto">
                                {identifiers.map((id, i) => (
                                    <div key={i} className="text-xs text-foreground truncate font-mono" title={id}>{id}</div>
                                ))}
                            </div>
                        </div>
                    </span>
                );
            })}
        </div>
    );
}

const columnHelper = createColumnHelper<WorkflowRow>();

export default function Workflows() {
    const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
    const [globalFilter, setGlobalFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [instanceFilter, setInstanceFilter] = useState('all');

    useEffect(() => {
        const load = async () => {
            try {
                const instancesRes = await authFetch('/instances');
                const instancesData = await instancesRes.json();

                const allWorkflows: WorkflowRow[] = [];
                for (const inst of instancesData.instances) {
                    const wfRes = await authFetch(`/instances/${inst.id}/workflows`);
                    const wfData = await wfRes.json();
                    allWorkflows.push(...wfData.workflows.map((w: any) => ({
                        ...w,
                        instance_name: inst.name,
                        node_count: parseInt(w.node_count) || 0,
                    })));
                }
                setWorkflows(allWorkflows);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const instanceNames = useMemo(() => {
        const names = new Set(workflows.map(w => w.instance_name));
        return Array.from(names).sort();
    }, [workflows]);

    const filtered = useMemo(() => {
        let result = workflows;
        if (statusFilter === 'active') result = result.filter(w => w.is_active);
        else if (statusFilter === 'inactive') result = result.filter(w => !w.is_active);
        if (instanceFilter !== 'all') result = result.filter(w => w.instance_name === instanceFilter);
        return result;
    }, [workflows, statusFilter, instanceFilter]);

    const statusCounts = useMemo(() => ({
        all: workflows.length,
        active: workflows.filter(w => w.is_active).length,
        inactive: workflows.filter(w => !w.is_active).length,
    }), [workflows]);

    const columns = useMemo(() => [
        columnHelper.accessor('name', {
            header: 'Name',
            cell: info => (
                <span className="text-foreground font-medium flex items-center gap-2">
                    <FileJson size={16} className="text-muted-foreground shrink-0" />
                    <span className="truncate max-w-[260px]" title={info.getValue()}>{info.getValue()}</span>
                </span>
            ),
        }),
        columnHelper.accessor('instance_name', {
            header: 'Instance',
            cell: info => <span className="text-muted-foreground text-xs">{info.getValue()}</span>,
        }),
        columnHelper.accessor('node_count', {
            header: 'Nodes',
            cell: info => <span className="text-muted-foreground">{info.getValue()}</span>,
            meta: { align: 'center' },
        }),
        columnHelper.accessor('is_active', {
            header: 'Status',
            cell: info => {
                const active = info.getValue();
                return (
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-secondary text-muted-foreground border-border'}`}>
                        {active ? 'Active' : 'Inactive'}
                    </span>
                );
            },
            meta: { align: 'center' },
        }),
        columnHelper.accessor('resources', {
            header: 'Resources',
            cell: info => <ResourceBadges resources={info.getValue()} />,
            enableSorting: false,
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
        initialState: { pagination: { pageSize: 20 } },
    });

    if (loading) return <div className="p-8 text-muted-foreground animate-pulse">Loading workflows...</div>;

    return (
        <div>
            <h1 className="text-2xl font-semibold text-foreground mb-6">Workflows</h1>

            {/* Filters */}
            <div className="flex items-center gap-6 mb-6">
                {/* Status filter */}
                <div className="flex gap-2">
                    {([
                        { key: 'all', label: 'All' },
                        { key: 'active', label: 'Active', icon: CheckCircle2, color: 'text-emerald-400' },
                        { key: 'inactive', label: 'Inactive', icon: XCircle, color: 'text-muted-foreground' },
                    ] as const).map(f => {
                        const count = statusCounts[f.key] || 0;
                        const active = statusFilter === f.key;
                        const Icon = 'icon' in f ? f.icon : null;
                        return (
                            <button
                                key={f.key}
                                onClick={() => setStatusFilter(f.key)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 border ${
                                    active
                                        ? 'bg-accent text-foreground border-border'
                                        : 'text-muted-foreground border-transparent hover:text-foreground'
                                }`}
                            >
                                {Icon && <Icon size={14} className={active && 'color' in f ? f.color : ''} />}
                                {f.label}
                                <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-secondary' : 'bg-secondary/50'}`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Instance filter */}
                {instanceNames.length > 1 && (
                    <>
                        <div className="w-px h-6 bg-border" />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setInstanceFilter('all')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 border ${
                                    instanceFilter === 'all'
                                        ? 'bg-accent text-foreground border-border'
                                        : 'text-muted-foreground border-transparent hover:text-foreground'
                                }`}
                            >
                                All Instances
                            </button>
                            {instanceNames.map(name => {
                                const count = workflows.filter(w => w.instance_name === name).length;
                                const active = instanceFilter === name;
                                return (
                                    <button
                                        key={name}
                                        onClick={() => setInstanceFilter(name)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 border ${
                                            active
                                                ? 'bg-accent text-foreground border-border'
                                                : 'text-muted-foreground border-transparent hover:text-foreground'
                                        }`}
                                    >
                                        {name}
                                        <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-secondary' : 'bg-secondary/50'}`}>
                                            {count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            <div className="card rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search workflows..."
                            value={globalFilter}
                            onChange={e => setGlobalFilter(e.target.value)}
                            className="pl-9 pr-4 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-72"
                        />
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {table.getFilteredRowModel().rows.length} of {filtered.length} workflows
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
                                                className={`px-6 py-4 ${header.column.getCanSort() ? 'cursor-pointer select-none hover:text-foreground transition-colors' : ''} ${align === 'center' ? 'text-center' : ''}`}
                                                onClick={header.column.getToggleSortingHandler()}
                                            >
                                                <span className={`flex items-center gap-1.5 ${align === 'center' ? 'justify-center' : 'justify-between'}`}>
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
                                        No workflows found.
                                    </td>
                                </tr>
                            ) : (
                                table.getRowModel().rows.map(row => (
                                    <tr key={row.id} className="hover:bg-secondary/50 transition-colors duration-150 group">
                                        {row.getVisibleCells().map(cell => {
                                            const align = (cell.column.columnDef.meta as any)?.align;
                                            return (
                                                <td key={cell.id} className={`px-6 py-3 ${align === 'center' ? 'text-center' : ''}`}>
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
                            {[10, 20, 50, 100].map(size => (
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
