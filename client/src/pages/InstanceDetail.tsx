import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, FileJson, Play, AlertCircle, Check, Copy, Pencil, Trash2, Power, RefreshCw, Shield, Database, Cpu, Globe, Zap, X, Loader2, Key } from 'lucide-react';
import { authFetch } from '../lib/auth';
import { updateInstance, deleteInstance, toggleInstance, rotateSecret } from '../lib/api';

export default function InstanceDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState<any>(null);
    const [workflows, setWorkflows] = useState<any[]>([]);
    const [executions, setExecutions] = useState<any[]>([]);
    const [resources, setResources] = useState<Record<string, any[]>>({});
    const [loading, setLoading] = useState(true);
    const [downloaded, setDownloaded] = useState(false);
    const [activeTab, setActiveTab] = useState<'workflows' | 'executions' | 'resources'>('workflows');

    // Action states
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [rotateOpen, setRotateOpen] = useState(false);
    const [newSecret, setNewSecret] = useState('');
    const [actionLoading, setActionLoading] = useState('');
    const [actionError, setActionError] = useState('');

    // Execution filters
    const [filterWorkflow, setFilterWorkflow] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const [execLoading, setExecLoading] = useState(false);

    // Edit form
    const [editName, setEditName] = useState('');
    const [editEnv, setEditEnv] = useState('');

    // n8n API key
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [apiKeySaving, setApiKeySaving] = useState(false);
    const [apiKeyMsg, setApiKeyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const fetchData = async () => {
        try {
            const [inst, wfs, execs, res] = await Promise.all([
                authFetch(`/instances/${id}`).then(r => r.json()),
                authFetch(`/instances/${id}/workflows`).then(r => r.json()),
                authFetch(`/instances/${id}/executions?limit=20`).then(r => r.json()),
                authFetch(`/instances/${id}/resources`).then(r => r.json())
            ]);
            setData(inst);
            setWorkflows(wfs.workflows);
            setExecutions(execs.executions);
            setResources(res.resources || {});
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [id]);

    const fetchExecutions = async () => {
        setExecLoading(true);
        try {
            const params = new URLSearchParams({ limit: '100' });
            if (filterWorkflow) params.set('workflow_id', filterWorkflow);
            if (filterStatus) params.set('status', filterStatus);
            if (filterDateFrom) params.set('date_from', new Date(filterDateFrom).toISOString());
            if (filterDateTo) params.set('date_to', new Date(filterDateTo + 'T23:59:59').toISOString());
            const res = await authFetch(`/instances/${id}/executions?${params}`).then(r => r.json());
            setExecutions(res.executions);
        } catch (e) { console.error(e); }
        finally { setExecLoading(false); }
    };

    const handleDownload = async () => {
        try {
            const response = await fetch('/reporter-workflow.json');
            const workflow = await response.json();

            // Fetch the current per-instance webhook URL from server
            const webhookRes = await authFetch(`/instances/${data.instance.id}/webhook-url`);
            const { webhook_url: webhookUrl } = await webhookRes.json();

            let jsonString = JSON.stringify(workflow, null, 2);
            jsonString = jsonString.replace(/YOUR_INSTANCE_ID/g, data.instance.id);
            jsonString = jsonString.replace(/YOUR_HMAC_SECRET/g, data.instance.hmac_secret);
            jsonString = jsonString.replace(/YOUR_WEBHOOK_URL/g, webhookUrl);

            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sentinel-reporter-${data.instance.name.replace(/\s+/g, '-').toLowerCase()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setDownloaded(true);
        } catch (e) {
            console.error('Failed to download workflow', e);
        }
    };

    const handleEdit = async () => {
        setActionLoading('edit');
        setActionError('');
        try {
            await updateInstance(id!, { name: editName, environment: editEnv });
            setEditOpen(false);
            await fetchData();
        } catch (err: any) {
            setActionError(err.message);
        } finally {
            setActionLoading('');
        }
    };

    const handleDelete = async () => {
        setActionLoading('delete');
        setActionError('');
        try {
            await deleteInstance(id!);
            navigate('/instances');
        } catch (err: any) {
            setActionError(err.message);
            setActionLoading('');
        }
    };

    const handleToggle = async () => {
        setActionLoading('toggle');
        setActionError('');
        try {
            await toggleInstance(id!);
            await fetchData();
        } catch (err: any) {
            setActionError(err.message);
        } finally {
            setActionLoading('');
        }
    };

    const handleRotate = async () => {
        setActionLoading('rotate');
        setActionError('');
        try {
            const result = await rotateSecret(id!);
            setNewSecret(result.instance.hmac_secret);
            await fetchData();
        } catch (err: any) {
            setActionError(err.message);
        } finally {
            setActionLoading('');
        }
    };

    const handleSaveApiKey = async () => {
        setApiKeySaving(true);
        setApiKeyMsg(null);
        try {
            const res = await authFetch(`/instances/${id}/api-key`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKeyInput || null }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to save');
            setApiKeyMsg({ type: 'success', text: apiKeyInput ? 'API key saved (encrypted)' : 'API key cleared' });
            setApiKeyInput('');
            await fetchData();
        } catch (err: any) {
            setApiKeyMsg({ type: 'error', text: err.message });
        } finally {
            setApiKeySaving(false);
        }
    };

    if (loading) return <div className="p-8 text-muted-foreground animate-pulse">Loading...</div>;
    if (!data || data.error) return <div className="p-8 text-muted-foreground">Instance not found</div>;

    const { instance, stats, latest_reporter_version } = data;
    const heartbeatAge = instance.last_heartbeat ? (Date.now() - new Date(instance.last_heartbeat).getTime()) / 60000 : null;
    const reporterOutdated = instance.reporter_version && latest_reporter_version && instance.reporter_version !== latest_reporter_version;
    const versionsBehind = (() => {
        if (!reporterOutdated) return 0;
        const parse = (v: string) => v.split('.').map(Number);
        const [cMaj, cMin] = parse(instance.reporter_version);
        const [lMaj, lMin] = parse(latest_reporter_version);
        if (cMaj < lMaj) return (lMaj - cMaj) * 100 + (lMin - cMin);
        if (cMin < lMin) return lMin - cMin;
        return 1;
    })();
    const statusColor = !instance.is_active ? 'text-gray-400' : !heartbeatAge ? 'text-gray-400' : heartbeatAge > 30 ? 'text-red-400' : heartbeatAge > 10 ? 'text-amber-400' : 'text-emerald-400';
    const statusLabel = !instance.is_active ? 'Disabled' : !heartbeatAge ? 'Pending' : heartbeatAge > 30 ? 'Offline' : heartbeatAge > 10 ? 'Stale' : 'Healthy';
    const errorRate24h = stats.executions_24h > 0 ? ((stats.errors_24h / stats.executions_24h) * 100).toFixed(1) : '0.0';

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <Link to="/instances" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2 transition-colors">
                    <ArrowLeft size={14} /> Back to Instances
                </Link>
                <div className="flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-semibold text-foreground">{instance.name}</h1>
                            {!instance.is_active && <span className="px-2 py-0.5 rounded-md text-[11px] font-medium border bg-gray-500/10 text-gray-400 border-gray-500/20">Disabled</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <MetaBadge icon={<Globe size={10} />} label={instance.environment || 'unknown'} />
                            {instance.n8n_version && <MetaBadge icon={<Zap size={10} />} label={`n8n ${instance.n8n_version}`} />}
                            {instance.database_type && <MetaBadge icon={<Database size={10} />} label={instance.database_type} />}
                            {instance.execution_mode && <MetaBadge icon={<Cpu size={10} />} label={instance.execution_mode} />}
                            {instance.reporter_version && <MetaBadge icon={<Shield size={10} />} label={`reporter ${instance.reporter_version}`} danger={reporterOutdated} tooltip={reporterOutdated ? `Your version is out of date by ${versionsBehind} version${versionsBehind > 1 ? 's' : ''}. Please update to ${latest_reporter_version} to get the latest features.` : undefined} />}
                            <div className={`flex items-center gap-1.5 text-xs font-medium ${statusColor}`}>
                                <div className={`w-2 h-2 rounded-full ${statusColor.replace('text-', 'bg-')} ${statusLabel === 'Healthy' ? 'animate-pulse' : ''}`} />
                                {statusLabel}
                            </div>
                        </div>
                        <div className="text-xs text-muted-foreground/50 font-mono mt-1.5">{instance.id}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <ActionBtn icon={<FileJson size={14} />} label={downloaded ? 'Downloaded' : 'Reporter'} onClick={handleDownload} active={downloaded} urgent={reporterOutdated && !downloaded} tooltip={reporterOutdated ? `Update available: v${latest_reporter_version}` : undefined} />
                        <ActionBtn icon={<Pencil size={14} />} label="Edit" onClick={() => { setEditName(instance.name); setEditEnv(instance.environment || ''); setEditOpen(true); setActionError(''); }} />
                        <ActionBtn icon={<RefreshCw size={14} />} label="Rotate Secret" onClick={() => { setRotateOpen(true); setNewSecret(''); setActionError(''); }} />
                        <ActionBtn icon={<Power size={14} />} label={instance.is_active ? 'Disable' : 'Enable'} onClick={handleToggle} loading={actionLoading === 'toggle'} danger={instance.is_active} />
                        <ActionBtn icon={<Trash2 size={14} />} label="Delete" onClick={() => { setDeleteOpen(true); setActionError(''); }} danger />
                    </div>
                </div>
                {instance.last_heartbeat && (
                    <div className="mt-3 text-xs text-muted-foreground">
                        Last heartbeat: <span className="font-mono text-foreground">{new Date(instance.last_heartbeat).toLocaleString()}</span>
                        {heartbeatAge !== null && <span className="ml-1 text-muted-foreground/60">({Math.round(heartbeatAge)}m ago)</span>}
                    </div>
                )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <StatCard label="Active Workflows" value={`${stats.active_workflows}/${stats.total_workflows}`} icon={<FileJson size={18} />} />
                <StatCard label="Exec (24h)" value={stats.executions_24h} icon={<Play size={18} />} />
                <StatCard label="Exec (7d)" value={stats.executions_7d} icon={<Play size={18} />} />
                <StatCard label="Errors (24h)" value={stats.errors_24h} icon={<AlertCircle size={18} />} color={stats.errors_24h > 0 ? 'text-red-400' : undefined} />
                <StatCard label="Error Rate" value={`${errorRate24h}%`} icon={<AlertCircle size={18} />} color={parseFloat(errorRate24h) > 10 ? 'text-red-400' : parseFloat(errorRate24h) > 5 ? 'text-amber-400' : undefined} />
                <StatCard label="Tokens (24h)" value={formatTokens(stats.tokens_24h)} icon={<Zap size={18} />} />
            </div>

            {/* n8n API Key */}
            <div className="card rounded-lg p-5">
                <div className="flex items-center gap-2 mb-3">
                    <Key size={14} className="text-amber-400" />
                    <h3 className="text-sm font-semibold text-foreground">n8n API Key</h3>
                    {instance.has_n8n_api_key ? (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-medium border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Configured</span>
                    ) : (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-medium border bg-amber-500/10 text-amber-400 border-amber-500/20">Not Set</span>
                    )}
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                    Required for AI error diagnosis enrichment and Fix with AI. The key is encrypted at rest and only used to fetch execution details and apply fixes.
                </p>
                <div className="flex items-center gap-2">
                    <input
                        type="password"
                        placeholder={instance.has_n8n_api_key ? 'Key is set — enter new key to replace' : 'Paste your n8n API key'}
                        value={apiKeyInput}
                        onChange={e => setApiKeyInput(e.target.value)}
                        className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/50 font-mono"
                    />
                    <button
                        onClick={handleSaveApiKey}
                        disabled={apiKeySaving || (!apiKeyInput && !instance.has_n8n_api_key)}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors duration-150 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        {apiKeySaving ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
                        {apiKeyInput ? 'Save' : instance.has_n8n_api_key ? 'Clear' : 'Save'}
                    </button>
                </div>
                {apiKeyMsg && (
                    <div className={`mt-2 text-xs ${apiKeyMsg.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {apiKeyMsg.text}
                    </div>
                )}
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 border-b border-border pb-0">
                {(['workflows', 'executions', 'resources'] as const).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2.5 text-sm font-medium transition-colors duration-150 border-b-2 -mb-px ${
                        activeTab === tab ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'
                    }`}>
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        <span className="ml-1.5 text-[10px] bg-secondary border border-border px-1.5 py-0.5 rounded">
                            {tab === 'workflows' ? workflows.length : tab === 'executions' ? executions.length : Object.values(resources).flat().length}
                        </span>
                    </button>
                ))}
            </div>

            {activeTab === 'workflows' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="card rounded-lg overflow-hidden lg:col-span-2">
                    <div className="px-5 py-3 border-b border-border flex justify-between items-center">
                        <h3 className="font-medium text-foreground text-sm">Workflows</h3>
                        <span className="text-xs text-muted-foreground">{workflows.length}</span>
                    </div>
                    <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                        {workflows.length === 0 ? <div className="p-4 text-center text-muted-foreground">No workflows synced yet</div> :
                        workflows.map((wf: any) => (
                            <div key={wf.id} className="p-4 hover:bg-secondary/50 transition-colors duration-150">
                                <div className="flex justify-between">
                                    <div className="font-medium text-primary truncate">{wf.name}</div>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium border ${wf.is_active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-secondary text-muted-foreground border-border'}`}>
                                        {wf.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {wf.resources?.slice(0, 3).map((res: any, i: number) => (
                                        <span key={i} className="text-[10px] border border-border bg-secondary px-1.5 py-0.5 rounded text-muted-foreground flex items-center gap-1">
                                            {res.type === 'ai_model' ? '🤖' : res.type === 'google_sheet' ? '📊' : '🌐'}
                                            {res.identifier}
                                        </span>
                                    ))}
                                    {wf.resources?.length > 3 && <span className="text-[10px] text-muted-foreground">+{wf.resources.length - 3} more</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            )}

            {activeTab === 'executions' && (
            <div className="space-y-4">
                {/* Execution Filters */}
                <div className="flex flex-wrap gap-3 items-end">
                    <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">Workflow</label>
                        <select value={filterWorkflow} onChange={e => setFilterWorkflow(e.target.value)} className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm min-w-[180px] outline-none focus:ring-1 focus:ring-primary/50">
                            <option value="">All Workflows</option>
                            {workflows.map(wf => <option key={wf.id} value={wf.id}>{wf.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">Status</label>
                        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm min-w-[130px] outline-none focus:ring-1 focus:ring-primary/50">
                            <option value="">All Statuses</option>
                            <option value="success">Success</option>
                            <option value="error">Error</option>
                            <option value="running">Running</option>
                            <option value="waiting">Waiting</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">From</label>
                        <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary/50" />
                    </div>
                    <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">To</label>
                        <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary/50" />
                    </div>
                    <button onClick={fetchExecutions} disabled={execLoading} className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors duration-150">
                        {execLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Apply
                    </button>
                    {(filterWorkflow || filterStatus || filterDateFrom || filterDateTo) && (
                        <button onClick={() => { setFilterWorkflow(''); setFilterStatus(''); setFilterDateFrom(''); setFilterDateTo(''); }} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground bg-secondary border border-border transition-colors duration-150">
                            Clear
                        </button>
                    )}
                </div>

                <div className="card rounded-lg overflow-hidden">
                    <div className="px-5 py-3 border-b border-border flex justify-between items-center">
                        <h3 className="font-medium text-foreground text-sm">Executions</h3>
                        <span className="text-xs text-muted-foreground">{executions.length}</span>
                    </div>
                    <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                        {executions.length === 0 ? <div className="p-4 text-center text-muted-foreground">No executions found</div> :
                            executions.map((exec: any) => (
                                <div key={exec.id} className="p-4 hover:bg-secondary/50 transition-colors duration-150 flex justify-between items-center">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <StatusDot status={exec.status} />
                                            <span className="font-medium text-sm text-foreground">{exec.workflow_name || 'Unknown Workflow'}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground flex gap-3">
                                            <span className="flex items-center gap-1"><Clock size={10} /> {new Date(exec.started_at).toLocaleTimeString()}</span>
                                            <span>{exec.duration_ms}ms</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-mono text-muted-foreground">#{exec.remote_execution_id}</span>
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            </div>
            )}

            {activeTab === 'resources' && (
            <div className="space-y-6">
                {Object.keys(resources).length === 0 ? (
                    <div className="card rounded-lg p-8 text-center text-muted-foreground text-sm">
                        No resources detected yet. Resources are discovered from workflow node configurations during reporter syncs.
                    </div>
                ) : (
                    Object.entries(resources).map(([type, items]) => (
                        <div key={type} className="card rounded-lg overflow-hidden">
                            <div className="px-5 py-3 border-b border-border flex justify-between items-center">
                                <h3 className="font-medium text-foreground text-sm flex items-center gap-2">
                                    <span>{resourceTypeIcon(type)}</span>
                                    {resourceTypeLabel(type)}
                                </h3>
                                <span className="text-xs text-muted-foreground">{items.length}</span>
                            </div>
                            <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                                {items.map((r: any, i: number) => (
                                    <div key={i} className="p-4 hover:bg-secondary/50 transition-colors duration-150">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="font-medium text-sm text-foreground font-mono">{r.resource_identifier}</div>
                                                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                                                    {r.provider && <span className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-[10px]">{r.provider}</span>}
                                                    <span>in <span className="text-primary">{r.workflow_name}</span></span>
                                                    {r.node_name && <span className="text-muted-foreground/50">({r.node_name})</span>}
                                                </div>
                                            </div>
                                            <div className="text-[10px] text-muted-foreground/50 text-right">
                                                {r.last_seen_at && <>Last seen {new Date(r.last_seen_at).toLocaleDateString()}</>}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
            )}

            {/* Edit Modal */}
            {editOpen && (
                <Modal title="Edit Instance" onClose={() => setEditOpen(false)}>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1.5">Name</label>
                            <input className="w-full bg-secondary border border-border rounded-lg p-3 text-sm focus:ring-1 focus:ring-primary/50 outline-none" value={editName} onChange={e => setEditName(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1.5">Environment</label>
                            <select className="w-full bg-secondary border border-border rounded-lg p-3 text-sm focus:ring-1 focus:ring-primary/50 outline-none" value={editEnv} onChange={e => setEditEnv(e.target.value)}>
                                <option value="production">Production</option>
                                <option value="staging">Staging</option>
                                <option value="development">Development</option>
                            </select>
                        </div>
                        {actionError && <p className="text-xs text-red-400">{actionError}</p>}
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-lg text-sm bg-secondary border border-border text-muted-foreground hover:bg-accent">Cancel</button>
                            <button onClick={handleEdit} disabled={actionLoading === 'edit' || !editName.trim()} className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors duration-150">
                                {actionLoading === 'edit' && <Loader2 size={14} className="animate-spin" />} Save
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Delete Confirmation */}
            {deleteOpen && (
                <Modal title="Delete Instance" onClose={() => setDeleteOpen(false)}>
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            This will permanently delete <span className="text-foreground font-semibold">{instance.name}</span> and all associated workflows, executions, and resources. This action cannot be undone.
                        </p>
                        {actionError && <p className="text-xs text-red-400">{actionError}</p>}
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setDeleteOpen(false)} className="px-4 py-2 rounded-lg text-sm bg-secondary border border-border text-muted-foreground hover:bg-accent">Cancel</button>
                            <button onClick={handleDelete} disabled={actionLoading === 'delete'} className="px-4 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50 flex items-center gap-2 transition-colors duration-150">
                                {actionLoading === 'delete' && <Loader2 size={14} className="animate-spin" />} Delete Instance
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Rotate Secret Modal */}
            {rotateOpen && (
                <Modal title="Rotate HMAC Secret" onClose={() => setRotateOpen(false)}>
                    <div className="space-y-4">
                        {!newSecret ? (
                            <>
                                <p className="text-sm text-muted-foreground">
                                    This will generate a new HMAC secret. The previous secret will remain valid for <span className="text-foreground font-semibold">24 hours</span> to allow updating the Reporter workflow.
                                </p>
                                {actionError && <p className="text-xs text-red-400">{actionError}</p>}
                                <div className="flex gap-2 justify-end">
                                    <button onClick={() => setRotateOpen(false)} className="px-4 py-2 rounded-lg text-sm bg-secondary border border-border text-muted-foreground hover:bg-accent">Cancel</button>
                                    <button onClick={handleRotate} disabled={actionLoading === 'rotate'} className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors duration-150">
                                        {actionLoading === 'rotate' && <Loader2 size={14} className="animate-spin" />} Rotate Secret
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-400">
                                    Secret rotated successfully. Update your Reporter workflow with the new secret within 24 hours.
                                </div>
                                <CopyField label="New HMAC Secret" value={newSecret} />
                                <div className="flex justify-end">
                                    <button onClick={() => { setRotateOpen(false); handleDownload(); }} className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 transition-colors duration-150">
                                        <FileJson size={14} /> Download Updated Reporter
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    );
}

function MetaBadge({ icon, label, danger, tooltip }: { icon: React.ReactNode; label: string; danger?: boolean; tooltip?: string }) {
    return (
        <span title={tooltip} className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-medium ${
            danger ? 'text-red-400 bg-red-500/10 border border-red-500/30 animate-pulse' : 'text-muted-foreground bg-secondary border border-border'
        }`}>
            {icon} {label}
        </span>
    );
}

function ActionBtn({ icon, label, onClick, danger, urgent, active, loading: isLoading, tooltip }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; urgent?: boolean; active?: boolean; loading?: boolean; tooltip?: string }) {
    return (
        <button onClick={onClick} disabled={isLoading} title={tooltip} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-150 border disabled:opacity-50 ${
            active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
            urgent ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20 animate-pulse' :
            danger ? 'bg-secondary text-red-400 border-border hover:bg-red-500/10 hover:border-red-500/20' :
            'bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground'
        }`}>
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : icon} {label}
        </button>
    );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="card rounded-lg shadow-lg max-w-md w-full p-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-semibold text-foreground">{title}</h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

function CopyField({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <div>
            <label className="block text-xs text-muted-foreground mb-1">{label}</label>
            <div className="flex items-center gap-2 bg-secondary border border-border rounded-lg p-2.5">
                <code className="text-xs font-mono text-foreground flex-1 truncate">{value}</code>
                <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="shrink-0 text-muted-foreground hover:text-foreground">
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
            </div>
        </div>
    );
}

function StatCard({ label, value, icon, color }: { label: string; value: any; icon: React.ReactNode; color?: string }) {
    return (
        <div className="card p-4 rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">{icon}<span className="text-xs">{label}</span></div>
            <div className={`text-xl font-bold ${color || 'text-foreground'}`}>{value}</div>
        </div>
    );
}

function StatusDot({ status }: { status: string }) {
    const colors: any = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        running: 'bg-blue-500 animate-pulse',
        waiting: 'bg-orange-400'
    };
    return <div className={`w-2.5 h-2.5 rounded-full ${colors[status] || 'bg-gray-400'}`} />;
}

function resourceTypeIcon(type: string): string {
    const icons: Record<string, string> = {
        ai_model: '🤖', google_sheet: '📊', api_endpoint: '🌐', webhook: '🔗',
        database: '🗄️', email: '📧', slack_channel: '💬', credential: '🔑',
        s3_bucket: '☁️', file: '📁',
    };
    return icons[type] || '📦';
}

function resourceTypeLabel(type: string): string {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + 's';
}

function formatTokens(n: number | string): string {
    const num = typeof n === 'string' ? parseInt(n) : n;
    if (!num || num === 0) return '0';
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toString();
}
