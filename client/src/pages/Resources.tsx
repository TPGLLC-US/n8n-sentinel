import { useEffect, useMemo, useState } from 'react';
import {
    Database, Search, Cpu, Globe, FileSpreadsheet, KeyRound, ShieldAlert,
    Mail, HardDrive, Webhook, MessageSquare, CalendarDays, Share2,
    ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight,
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

interface ProviderInfo {
    id: string;
    name: string;
    logoUrl: string;
    modelCount: number;
}

interface ResourceRow {
    resource_type: string;
    resource_identifier: string;
    provider: string;
    node_name: string;
    credential_name: string;
    credential_id: string;
    credential_exposed: boolean;
    workflow_count: number;
    last_seen: string;
    instance_id: string;
    instance_name: string;
    instance_base_url: string;
    workflows: { name: string; remote_id: string }[];
}

const TYPE_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'ai_model', label: 'AI Models', icon: Cpu },
    { key: 'ai_embedding', label: 'Embeddings', icon: Cpu },
    { key: 'api_domain', label: 'APIs', icon: Globe },
    { key: 'google_doc', label: 'Docs', icon: Database },
    { key: 'google_sheet', label: 'Sheets', icon: FileSpreadsheet },
    { key: 'google_slide', label: 'Slides', icon: FileSpreadsheet },
    { key: 'google_drive', label: 'Drive', icon: Database },
    { key: 'database', label: 'Databases', icon: HardDrive },
    { key: 'webhook', label: 'Webhooks', icon: Webhook },
    { key: 'messaging', label: 'Messaging', icon: MessageSquare },
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
    { key: 'social', label: 'Social', icon: Share2 },
    { key: 'gmail', label: 'Gmail', icon: Mail },
    { key: 'credential', label: 'Credentials', icon: KeyRound },
];

const TYPE_COLORS: Record<string, string> = {
    ai_model: 'bg-violet-500/10 text-violet-400',
    ai_embedding: 'bg-indigo-500/10 text-indigo-400',
    api_domain: 'bg-blue-500/10 text-blue-400',
    credential: 'bg-amber-500/10 text-amber-400',
    webhook: 'bg-rose-500/10 text-rose-400',
    messaging: 'bg-sky-500/10 text-sky-400',
    calendar: 'bg-orange-500/10 text-orange-400',
    social: 'bg-pink-500/10 text-pink-400',
    database: 'bg-teal-500/10 text-teal-400',
    gmail: 'bg-red-500/10 text-red-400',
};

function ProviderLogo({ provider, providers }: { provider: string; providers: ProviderInfo[] }) {
    const info = providers.find(p => p.id === provider);
    const logoUrl = info?.logoUrl || `https://models.dev/logos/${provider}.svg`;
    const [imgError, setImgError] = useState(false);

    if (!provider || provider === 'unknown' || imgError) {
        return (
            <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center text-[9px] font-bold text-muted-foreground uppercase">
                {provider?.charAt(0) || '?'}
            </div>
        );
    }

    return (
        <img
            src={logoUrl}
            alt={info?.name || provider}
            className="w-5 h-5 rounded brightness-0 invert"
            onError={() => setImgError(true)}
        />
    );
}

function TypeIcon({ type }: { type: string }) {
    switch (type) {
        case 'ai_model': return <Cpu size={14} />;
        case 'ai_embedding': return <Cpu size={14} />;
        case 'credential': return <KeyRound size={14} />;
        case 'api_domain': return <Globe size={14} />;
        case 'google_sheet': return <FileSpreadsheet size={14} />;
        case 'google_slide': return <FileSpreadsheet size={14} />;
        case 'google_doc': return <Database size={14} />;
        case 'google_drive': return <Database size={14} />;
        case 'database': return <HardDrive size={14} />;
        case 'webhook': return <Webhook size={14} />;
        case 'messaging': return <MessageSquare size={14} />;
        case 'calendar': return <CalendarDays size={14} />;
        case 'social': return <Share2 size={14} />;
        case 'gmail': return <Mail size={14} />;
        default: return <Database size={14} />;
    }
}

const columnHelper = createColumnHelper<ResourceRow>();

export default function Resources() {
    const [resources, setResources] = useState<ResourceRow[]>([]);
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [typeFilter, setTypeFilter] = useState('all');
    const [instanceFilter, setInstanceFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'last_seen', desc: true }]);
    const [globalFilter, setGlobalFilter] = useState('');

    useEffect(() => {
        Promise.all([
            authFetch('/resources').then(r => r.json()),
            authFetch('/models/providers').then(r => r.json()).catch(() => ({ providers: [] })),
        ])
            .then(([resData, modelsData]) => {
                setResources((resData.resources || []).map((r: any) => ({
                    ...r,
                    workflow_count: parseInt(r.workflow_count) || 0,
                })));
                setProviders(modelsData.providers || []);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const instanceNames = useMemo(() => {
        const names = new Set(resources.map(r => r.instance_name).filter(Boolean));
        return Array.from(names).sort();
    }, [resources]);

    const isCredentialTab = typeFilter === 'credential';

    // Pre-filter by type and instance before feeding to table
    const filteredByType = useMemo(() => resources.filter(r => {
        if (typeFilter === 'credential') { if (r.resource_type !== 'credential') return false; }
        else if (typeFilter === 'all') { if (r.resource_type === 'credential') return false; }
        else { if (r.resource_type !== typeFilter) return false; }
        if (instanceFilter !== 'all' && r.instance_name !== instanceFilter) return false;
        return true;
    }), [resources, typeFilter, instanceFilter]);

    const nonCredResources = resources.filter(r => r.resource_type !== 'credential');
    const typeCounts = resources.reduce((acc: Record<string, number>, r) => {
        acc[r.resource_type] = (acc[r.resource_type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    // Columns for the main resource table
    const resourceColumns = useMemo(() => [
        columnHelper.accessor('resource_type', {
            header: 'Type',
            cell: info => {
                const type = info.getValue();
                return (
                    <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-md ${TYPE_COLORS[type] || 'bg-emerald-500/10 text-emerald-400'}`}>
                            <TypeIcon type={type} />
                        </div>
                        <span className="capitalize text-foreground font-medium text-xs whitespace-nowrap">
                            {type.replace(/_/g, ' ')}
                        </span>
                    </div>
                );
            },
            sortingFn: 'alphanumeric',
        }),
        columnHelper.accessor('instance_name', {
            header: 'Instance',
            cell: info => (
                <span className="text-xs text-foreground font-medium truncate max-w-[160px] block" title={info.getValue()}>
                    {info.getValue() || '—'}
                </span>
            ),
        }),
        columnHelper.accessor('resource_identifier', {
            header: 'Identifier / Name',
            cell: ({ row }) => {
                const id = row.original.resource_identifier;
                const type = row.original.resource_type;
                let href: string | null = null;
                if (type === 'google_sheet' && id) href = `https://docs.google.com/spreadsheets/d/${id}`;
                else if (type === 'google_doc' && id) href = `https://docs.google.com/document/d/${id}`;
                else if (type === 'google_slide' && id) href = `https://docs.google.com/presentation/d/${id}`;
                else if (type === 'google_drive' && id) href = `https://drive.google.com/drive/folders/${id}`;
                if (href) {
                    return (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                           className="font-mono text-xs text-primary/80 hover:text-primary truncate max-w-[280px] block transition-colors underline decoration-primary/20 hover:decoration-primary/60"
                           title={id}>
                            {id}
                        </a>
                    );
                }
                return (
                    <span className="font-mono text-xs text-primary/80 truncate max-w-[280px] block" title={id}>
                        {id}
                    </span>
                );
            },
        }),
        columnHelper.accessor('provider', {
            header: 'Provider',
            cell: info => {
                const provider = info.getValue();
                if (!provider || provider === 'unknown') return <span className="text-muted-foreground/50 text-xs">-</span>;
                return (
                    <div className="flex items-center gap-2">
                        <ProviderLogo provider={provider} providers={providers} />
                        <span className="text-muted-foreground text-xs capitalize">
                            {providers.find(p => p.id === provider)?.name || provider}
                        </span>
                    </div>
                );
            },
        }),
        columnHelper.accessor('credential_name', {
            header: 'Credential',
            cell: ({ row }) => {
                const res = row.original;
                if (res.credential_exposed) {
                    return (
                        <span className="relative group/cred cursor-default">
                            <span className="inline-flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-lg text-xs text-red-400 font-medium">
                                <ShieldAlert size={12} />
                                Hardcoded
                            </span>
                            <span className="absolute left-0 -top-8 bg-red-950 border border-red-500/30 text-red-300 text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover/cred:opacity-100 transition-opacity pointer-events-none z-10">
                                Auth key found in node params — use n8n credentials instead
                            </span>
                        </span>
                    );
                }
                if (res.credential_name) {
                    return (
                        <span className="relative group/cred cursor-default">
                            <span className="inline-flex items-center gap-1.5 bg-amber-500/5 border border-amber-500/10 px-2 py-1 rounded-lg text-xs text-amber-300/80">
                                <KeyRound size={10} />
                                {res.credential_name}
                            </span>
                            <span className="absolute left-0 -top-8 bg-card border border-border text-muted-foreground text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover/cred:opacity-100 transition-opacity pointer-events-none z-10">
                                ID: {res.credential_id}
                            </span>
                        </span>
                    );
                }
                return <span className="text-muted-foreground/30 text-xs">-</span>;
            },
        }),
        columnHelper.accessor('workflow_count', {
            header: 'Workflows',
            cell: ({ row }) => {
                const wfs = row.original.workflows || [];
                const baseUrl = row.original.instance_base_url;
                return (
                    <span className="relative group/wf cursor-default">
                        <span className="bg-secondary border border-border px-2 py-0.5 rounded-md text-xs font-medium text-muted-foreground">
                            {row.original.workflow_count}
                        </span>
                        {wfs.length > 0 && (
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 bg-card border border-border rounded-md shadow-md px-3 py-2 opacity-0 invisible group-hover/wf:opacity-100 group-hover/wf:visible hover:opacity-100 hover:visible transition-all z-20 min-w-[220px] max-w-[320px]">
                                <div className="text-[11px] text-muted-foreground font-medium mb-1.5">Linked Workflows</div>
                                <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                                    {wfs.map((wf: any, i: number) => {
                                        const href = baseUrl && safeHref(baseUrl) !== '#' ? `${baseUrl.replace(/\/$/, '')}/workflow/${wf.remote_id}` : null;
                                        return href ? (
                                            <a key={i} href={href} target="_blank" rel="noopener noreferrer"
                                               className="text-xs text-foreground truncate hover:text-primary transition-colors flex items-center gap-1" title={wf.name}>
                                                <span className="text-primary/70 font-mono shrink-0">#{wf.remote_id}</span>
                                                <span className="truncate">{wf.name || 'Unnamed'}</span>
                                            </a>
                                        ) : (
                                            <div key={i} className="text-xs text-foreground truncate" title={wf.name}>
                                                <span className="text-primary/70 font-mono mr-1.5">#{wf.remote_id}</span>
                                                {wf.name || 'Unnamed'}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </span>
                );
            },
            meta: { align: 'center' },
        }),
        columnHelper.accessor('last_seen', {
            header: 'Last Seen',
            cell: info => (
                <span className="text-muted-foreground text-xs font-mono">
                    {new Date(info.getValue()).toLocaleDateString()}
                </span>
            ),
            sortingFn: 'datetime',
            meta: { align: 'right' },
        }),
    ], [providers]);

    // Columns for the credentials tab
    const credentialColumns = useMemo(() => [
        columnHelper.accessor('node_name', {
            header: 'Credential Name',
            cell: ({ row }) => {
                const res = row.original;
                return (
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-400">
                            <KeyRound size={14} />
                        </div>
                        <span className="relative group/tip cursor-default">
                            <span className="text-foreground font-medium text-sm">{res.node_name || res.resource_identifier}</span>
                            <span className="absolute left-0 -top-8 bg-card border border-border text-muted-foreground text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-10">
                                ID: {res.resource_identifier}
                            </span>
                        </span>
                    </div>
                );
            },
        }),
        columnHelper.accessor('instance_name', {
            header: 'Instance',
            cell: info => (
                <span className="text-xs text-foreground font-medium truncate max-w-[160px] block" title={info.getValue()}>
                    {info.getValue() || '—'}
                </span>
            ),
        }),
        columnHelper.accessor('provider', {
            header: 'Provider',
            cell: info => {
                const provider = info.getValue();
                if (!provider || provider === 'unknown') return <span className="text-muted-foreground/50 text-xs">-</span>;
                return (
                    <div className="flex items-center gap-2">
                        <ProviderLogo provider={provider} providers={providers} />
                        <span className="text-muted-foreground text-xs capitalize">
                            {providers.find(p => p.id === provider)?.name || provider}
                        </span>
                    </div>
                );
            },
        }),
        columnHelper.accessor('workflow_count', {
            header: 'Workflows',
            cell: ({ row }) => {
                const wfs = row.original.workflows || [];
                const baseUrl = row.original.instance_base_url;
                return (
                    <span className="relative group/wf cursor-default">
                        <span className="bg-secondary border border-border px-2 py-0.5 rounded-md text-xs font-medium text-muted-foreground">
                            {row.original.workflow_count}
                        </span>
                        {wfs.length > 0 && (
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 bg-card border border-border rounded-md shadow-md px-3 py-2 opacity-0 invisible group-hover/wf:opacity-100 group-hover/wf:visible hover:opacity-100 hover:visible transition-all z-20 min-w-[220px] max-w-[320px]">
                                <div className="text-[11px] text-muted-foreground font-medium mb-1.5">Linked Workflows</div>
                                <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                                    {wfs.map((wf: any, i: number) => {
                                        const href = baseUrl && safeHref(baseUrl) !== '#' ? `${baseUrl.replace(/\/$/, '')}/workflow/${wf.remote_id}` : null;
                                        return href ? (
                                            <a key={i} href={href} target="_blank" rel="noopener noreferrer"
                                               className="text-xs text-foreground truncate hover:text-primary transition-colors flex items-center gap-1" title={wf.name}>
                                                <span className="text-primary/70 font-mono shrink-0">#{wf.remote_id}</span>
                                                <span className="truncate">{wf.name || 'Unnamed'}</span>
                                            </a>
                                        ) : (
                                            <div key={i} className="text-xs text-foreground truncate" title={wf.name}>
                                                <span className="text-primary/70 font-mono mr-1.5">#{wf.remote_id}</span>
                                                {wf.name || 'Unnamed'}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </span>
                );
            },
            meta: { align: 'center' },
        }),
        columnHelper.accessor('last_seen', {
            header: 'Last Seen',
            cell: info => (
                <span className="text-muted-foreground text-xs font-mono">
                    {new Date(info.getValue()).toLocaleDateString()}
                </span>
            ),
            sortingFn: 'datetime',
            meta: { align: 'right' },
        }),
    ], [providers]);

    const activeColumns = isCredentialTab ? credentialColumns : resourceColumns;

    const table = useReactTable({
        data: filteredByType,
        columns: activeColumns,
        state: { sorting, globalFilter },
        onSortingChange: setSorting,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: { pagination: { pageSize: 20 } },
    });

    if (loading) return <div className="p-8 text-muted-foreground animate-pulse">Loading resources...</div>;

    return (
        <div>
            <h1 className="text-2xl font-semibold text-foreground mb-6">Resources</h1>

            {/* Filters */}
            <div className="flex items-center gap-6 mb-6 flex-wrap">
                {/* Type filter tabs */}
                <div className="flex gap-2 flex-wrap">
                    {TYPE_FILTERS.map(f => {
                        const count = f.key === 'all' ? nonCredResources.length : (typeCounts[f.key] || 0);
                        if (f.key !== 'all' && count === 0) return null;
                        return (
                            <button
                                key={f.key}
                                onClick={() => { setTypeFilter(f.key); table.resetPageIndex(); }}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 flex items-center gap-1.5 border ${
                                    typeFilter === f.key
                                        ? 'bg-accent text-foreground border-border'
                                        : 'text-muted-foreground border-transparent hover:text-foreground'
                                }`}
                            >
                                {f.icon && <f.icon size={12} />}
                                {f.label}
                                <span className="bg-secondary px-1.5 py-0.5 rounded text-[10px]">{count}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Instance filter */}
                {instanceNames.length > 1 && (
                    <>
                        <div className="w-px h-6 bg-border" />
                        <div className="flex gap-2 flex-wrap">
                            <button
                                onClick={() => { setInstanceFilter('all'); table.resetPageIndex(); }}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 flex items-center gap-1.5 border ${
                                    instanceFilter === 'all'
                                        ? 'bg-accent text-foreground border-border'
                                        : 'text-muted-foreground border-transparent hover:text-foreground'
                                }`}
                            >
                                All Instances
                            </button>
                            {instanceNames.map(name => {
                                const count = resources.filter(r => r.instance_name === name).length;
                                const active = instanceFilter === name;
                                return (
                                    <button
                                        key={name}
                                        onClick={() => { setInstanceFilter(name); table.resetPageIndex(); }}
                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 flex items-center gap-1.5 border ${
                                            active
                                                ? 'bg-accent text-foreground border-border'
                                                : 'text-muted-foreground border-transparent hover:text-foreground'
                                        }`}
                                    >
                                        {name}
                                        <span className={`bg-secondary px-1.5 py-0.5 rounded text-[10px]`}>{count}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            <div className="card rounded-lg overflow-hidden">
                {/* Search bar + row count */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search resources..."
                            value={globalFilter}
                            onChange={e => setGlobalFilter(e.target.value)}
                            className="pl-9 pr-4 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-72"
                        />
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {table.getFilteredRowModel().rows.length} of {filteredByType.length} rows
                    </div>
                </div>

                {/* Table */}
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
                                                className={`px-6 py-4 cursor-pointer select-none hover:text-foreground transition-colors ${
                                                    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
                                                }`}
                                                onClick={header.column.getToggleSortingHandler()}
                                            >
                                                <span className={`flex items-center gap-1.5 ${
                                                    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-between'
                                                }`}>
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
                                    <td colSpan={activeColumns.length} className="px-6 py-12 text-center text-muted-foreground text-sm">
                                        {isCredentialTab ? 'No credentials found.' : 'No resources found.'}
                                    </td>
                                </tr>
                            ) : (
                                table.getRowModel().rows.map(row => (
                                    <tr key={row.id} className="hover:bg-secondary/50 transition-colors duration-150 group">
                                        {row.getVisibleCells().map(cell => {
                                            const align = (cell.column.columnDef.meta as any)?.align;
                                            return (
                                                <td key={cell.id} className={`px-6 py-3 ${
                                                    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
                                                }`}>
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
                        Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
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

            {/* Provider logos footer */}
            {providers.length > 0 && (
                <div className="mt-6 p-4 card rounded-lg">
                    <div className="text-xs text-muted-foreground mb-3">Model Providers (via models.dev)</div>
                    <div className="flex flex-wrap gap-3">
                        {providers.slice(0, 20).map(p => (
                            <div key={p.id} className="flex items-center gap-1.5 bg-secondary rounded-md px-2 py-1 border border-border">
                                <img
                                    src={p.logoUrl}
                                    alt={p.name}
                                    className="w-4 h-4 rounded"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                                <span className="text-[10px] text-muted-foreground">{p.name}</span>
                                <span className="text-[9px] text-muted-foreground/50">{p.modelCount}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
