import { useEffect, useState, useMemo } from 'react';
import { fetchInstances, registerInstance, verifyN8nUrl, VerifyError } from '../lib/api';
import { authFetch } from '../lib/auth';
import { Plus, Server, Copy, Check, FileJson, Key, Loader2, AlertCircle, ChevronRight, Shield, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

function Badge({ children, className }: { children: React.ReactNode, className?: string }) {
    return <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${className}`}>{children}</span>;
}

function Button({ children, onClick, className, variant = 'primary', disabled }: any) {
    const base = "px-4 py-2 rounded-lg font-medium transition-colors duration-150 flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed";
    const styles = variant === 'primary'
        ? "bg-primary text-primary-foreground hover:bg-primary/90"
        : "bg-secondary text-muted-foreground hover:text-foreground border border-border";
    return <button onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>{children}</button>;
}

export default function Instances() {
    const [instances, setInstances] = useState<any[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newInstance, setNewInstance] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [envFilter, setEnvFilter] = useState<string>('all');

    const environments = useMemo(() => {
        const envs = new Set(instances.map(i => i.environment).filter(Boolean));
        return ['all', ...Array.from(envs)];
    }, [instances]);

    const filtered = useMemo(() => {
        return instances.filter(inst => {
            if (envFilter !== 'all' && inst.environment !== envFilter) return false;
            if (searchQuery && !inst.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        });
    }, [instances, searchQuery, envFilter]);

    const loadInstances = async () => {
        try {
            const data = await fetchInstances();
            setInstances(data.instances);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        loadInstances();
        const interval = setInterval(loadInstances, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div>
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-2xl font-semibold text-foreground">Instances</h1>
                <Button onClick={() => setIsModalOpen(true)}>
                    <Plus size={16} /> Register Instance
                </Button>
            </div>

            {instances.length === 0 ? (
                <div className="text-center py-16 card rounded-lg border-dashed">
                    <Server size={32} className="mx-auto text-muted-foreground mb-3" />
                    <p className="text-muted-foreground text-sm">No instances registered yet.</p>
                    <Button variant="secondary" className="mt-4 mx-auto" onClick={() => setIsModalOpen(true)}>Register one now</Button>
                </div>
            ) : (
                <>
                <div className="flex items-center gap-3 mb-6">
                    <div className="relative flex-1 max-w-xs">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search instances..."
                            className="w-full bg-secondary border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                        />
                    </div>
                    <div className="flex gap-1">
                        {environments.map(env => (
                            <button
                                key={env}
                                onClick={() => setEnvFilter(env)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 border ${
                                    envFilter === env
                                        ? 'bg-accent text-foreground border-border'
                                        : 'text-muted-foreground border-transparent hover:text-foreground'
                                }`}
                            >
                                {env === 'all' ? 'All' : env.charAt(0).toUpperCase() + env.slice(1)}
                            </button>
                        ))}
                    </div>
                    <span className="text-xs text-muted-foreground/60 ml-auto">{filtered.length} of {instances.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filtered.map((inst) => (
                        <Link to={`/instances/${inst.id}`} key={inst.id} className="block">
                            <div className="card hover:border-muted-foreground/20 transition-colors duration-150 p-5 rounded-lg h-full">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                                        <div className={`w-1.5 h-1.5 rounded-full ${inst.environment === 'production' ? 'bg-red-400' : 'bg-blue-400'}`} />
                                        {inst.environment}
                                    </div>
                                    <StatusBadge lastHeartbeat={inst.last_heartbeat} />
                                </div>

                                <h3 className="text-base font-semibold mb-1 text-foreground">{inst.name}</h3>
                                <div className="text-xs text-muted-foreground font-mono mb-4 truncate">{inst.id}</div>

                                <div className="pt-3 border-t border-border grid grid-cols-4 gap-2 text-sm text-muted-foreground">
                                    <div>
                                        <div className="text-[11px] text-muted-foreground mb-0.5">Workflows</div>
                                        <div className="font-mono text-foreground">{inst.active_workflow_count ?? 0}<span className="text-muted-foreground">/{inst.workflow_count ?? 0}</span></div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] text-muted-foreground mb-0.5">Exec 24h</div>
                                        <div className="font-mono text-foreground">{inst.executions_24h ?? 0}</div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] text-muted-foreground mb-0.5">Errors</div>
                                        <div className={`font-mono ${inst.errors_24h > 0 ? 'text-red-400' : 'text-foreground'}`}>{inst.errors_24h ?? 0}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[11px] text-muted-foreground mb-0.5">Version</div>
                                        <div className="font-mono text-xs text-foreground">{inst.n8n_version || '-'}</div>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
                </>
            )}

            {/* Registration Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-background/80 flex items-center justify-center p-4 z-50">
                    <div className="bg-card rounded-lg max-w-md w-full overflow-hidden border border-border shadow-lg">
                        <div className="p-8">
                            <h3 className="text-xl font-bold mb-6 text-foreground">Register New Instance</h3>

                            {!newInstance ? (
                                <RegisterForm onSuccess={(data: any) => setNewInstance(data)} />
                            ) : (
                                <CredentialsDisplay data={newInstance} onClose={() => {
                                    setIsModalOpen(false);
                                    setNewInstance(null);
                                    loadInstances();
                                }} />
                            )}
                        </div>

                        {!newInstance && (
                            <div className="bg-secondary/50 p-4 flex justify-end border-t border-border">
                                <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function StatusBadge({ lastHeartbeat }: any) {
    if (!lastHeartbeat) return <Badge className="bg-gray-500/10 text-gray-400 border-gray-500/20">Pending</Badge>;

    const diff = new Date().getTime() - new Date(lastHeartbeat).getTime();
    const isStale = diff > 5 * 60 * 1000;

    if (isStale) return <Badge className="bg-red-500/10 text-red-400 border-red-500/20">Stale</Badge>;
    return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Healthy
    </Badge>;
}

function RegisterForm({ onSuccess }: any) {
    const [step, setStep] = useState<'details' | 'apikey' | 'registering'>('details');
    const [name, setName] = useState('');
    const [env, setEnv] = useState('production');
    const [instanceUrl, setInstanceUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [verifyState, setVerifyState] = useState<'idle' | 'checking' | 'verified' | 'error'>('idle');
    const [verifyError, setVerifyError] = useState('');
    const [verifyDetails, setVerifyDetails] = useState('');
    const [verifySuggestions, setVerifySuggestions] = useState<string[]>([]);
    const [verifyMethod, setVerifyMethod] = useState('');
    const [verifiedUrl, setVerifiedUrl] = useState('');
    const [baselineCounts, setBaselineCounts] = useState<{ workflows: number | null; executions: number | null }>({ workflows: null, executions: null });
    const [fetchingCounts, setFetchingCounts] = useState(false);
    const [countsFetched, setCountsFetched] = useState(false);
    const [countsError, setCountsError] = useState('');
    const [loading, setLoading] = useState(false);
    const [registerError, setRegisterError] = useState('');

    const inputClasses = "w-full bg-secondary border border-border rounded-lg p-3 text-sm focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50";

    const handleVerifyUrl = async () => {
        if (!instanceUrl.trim()) return;
        setVerifyState('checking');
        setVerifyError('');
        setVerifyDetails('');
        setVerifySuggestions([]);
        setVerifyMethod('');
        try {
            const result = await verifyN8nUrl(instanceUrl.trim());
            setVerifiedUrl(result.url);
            setVerifyMethod(result.verify_method || 'healthz');
            setVerifyState('verified');
        } catch (err: any) {
            setVerifyError(err.message);
            if (err instanceof VerifyError) {
                setVerifyDetails(err.details || '');
                setVerifySuggestions(err.suggestions || []);
            }
            setVerifyState('error');
        }
    };

    const handleFetchCounts = async () => {
        if (!apiKey.trim()) return;
        setFetchingCounts(true);
        setCountsError('');
        try {
            const result = await verifyN8nUrl(verifiedUrl, apiKey.trim());
            setBaselineCounts({ workflows: result.workflow_count, executions: result.execution_count });
            setCountsFetched(true);
        } catch (err: any) {
            setCountsError(err.message);
        } finally {
            setFetchingCounts(false);
        }
    };

    const handleRegister = async () => {
        setLoading(true);
        setRegisterError('');
        try {
            const data = await registerInstance({
                name,
                environment: env,
                base_url: verifiedUrl || instanceUrl.trim() || undefined,
                baseline_workflow_count: baselineCounts.workflows,
                baseline_execution_count: baselineCounts.executions,
            });
            onSuccess(data);
        } catch (err: any) {
            setRegisterError(err.message || 'Error creating instance');
        } finally {
            setLoading(false);
        }
    };

    if (step === 'details') {
        return (
            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Instance Name</label>
                    <input required className={inputClasses} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Production Main" />
                </div>
                <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Environment</label>
                    <select className={inputClasses} value={env} onChange={e => setEnv(e.target.value)}>
                        <option value="production">Production</option>
                        <option value="staging">Staging</option>
                        <option value="development">Development</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                        Instance URL
                    </label>
                    <div className="flex gap-2">
                        <input
                            className={`${inputClasses} ${verifyState === 'verified' ? 'border-emerald-500/50 text-emerald-400' : verifyState === 'error' ? 'border-red-500/50' : ''}`}
                            value={instanceUrl}
                            onChange={e => { setInstanceUrl(e.target.value); setVerifyState('idle'); setVerifyError(''); setVerifyDetails(''); setVerifySuggestions([]); }}
                            placeholder="https://n8n.example.com"
                        />
                        <button
                            type="button"
                            onClick={handleVerifyUrl}
                            disabled={!instanceUrl.trim() || verifyState === 'checking'}
                            className="px-4 py-2 rounded-lg text-xs font-medium transition-colors duration-150 border shrink-0 disabled:opacity-50 disabled:cursor-not-allowed bg-secondary border-border hover:bg-accent text-muted-foreground hover:text-foreground"
                        >
                            {verifyState === 'checking' ? <Loader2 size={14} className="animate-spin" /> :
                             verifyState === 'verified' ? <Check size={14} className="text-emerald-400" /> :
                             'Verify'}
                        </button>
                    </div>
                    {verifyState === 'verified' && (
                        <div className="mt-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5 text-xs text-emerald-400 flex items-center gap-2">
                            <Check size={14} className="shrink-0" />
                            <div>
                                <span className="font-semibold">Confirmed n8n instance</span> at {verifiedUrl}
                                <span className="ml-2 text-[10px] bg-emerald-500/20 px-1.5 py-0.5 rounded-md font-medium">
                                    via {verifyMethod}
                                </span>
                            </div>
                        </div>
                    )}
                    {verifyState === 'error' && (
                        <div className="mt-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2">
                            <p className="text-xs text-red-400 font-semibold flex items-center gap-1.5">
                                <AlertCircle size={13} className="shrink-0" /> {verifyError}
                            </p>
                            {verifyDetails && (
                                <p className="text-[11px] text-red-300/70 pl-5 font-mono">{verifyDetails}</p>
                            )}
                            {verifySuggestions.length > 0 && (
                                <ul className="text-[11px] text-muted-foreground pl-5 space-y-1 border-t border-red-500/10 pt-2 mt-2">
                                    <li className="text-[11px] font-medium text-muted-foreground mb-1">Possible causes</li>
                                    {verifySuggestions.map((s, i) => (
                                        <li key={i} className="flex items-start gap-1.5">
                                            <span className="text-red-400/60 mt-0.5">-</span>
                                            <span>{s}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                <Button
                    type="button"
                    onClick={() => setStep('apikey')}
                    className="w-full justify-center mt-2"
                    disabled={!name.trim() || verifyState !== 'verified'}
                >
                    Next <ChevronRight size={14} />
                </Button>
                {!instanceUrl.trim() && name.trim() && (
                    <button
                        type="button"
                        onClick={() => { setVerifiedUrl(''); setStep('apikey'); }}
                        className="w-full text-center text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors mt-1"
                    >
                        Skip URL verification (not recommended)
                    </button>
                )}
            </div>
        );
    }

    if (step === 'apikey') {
        return (
            <div className="space-y-4">
                {verifiedUrl ? (
                    <>
                        <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 p-3 rounded-lg text-xs flex items-start gap-2.5">
                            <Key size={14} className="shrink-0 mt-0.5" />
                            <div>
                                <span className="font-bold block mb-0.5">Optional: Temporary API Key</span>
                                Provide a temporary n8n API key to fetch your current workflow and execution counts as a baseline.
                                The key is used once and <strong>never stored</strong>.
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                n8n API Key
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="password"
                                    className={inputClasses}
                                    value={apiKey}
                                    onChange={e => { setApiKey(e.target.value); setCountsFetched(false); setCountsError(''); }}
                                    placeholder="Paste your n8n API key"
                                />
                                <button
                                    type="button"
                                    onClick={handleFetchCounts}
                                    disabled={!apiKey.trim() || fetchingCounts}
                                    className="px-4 py-2 rounded-lg text-xs font-medium transition-colors duration-150 border shrink-0 disabled:opacity-50 disabled:cursor-not-allowed bg-secondary border-border hover:bg-accent text-muted-foreground hover:text-foreground"
                                >
                                    {fetchingCounts ? <Loader2 size={14} className="animate-spin" /> :
                                     countsFetched ? <Check size={14} className="text-emerald-400" /> :
                                     'Fetch Counts'}
                                </button>
                            </div>
                            {countsError && (
                                <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
                                    <AlertCircle size={12} /> {countsError}
                                </p>
                            )}
                        </div>

                        {countsFetched && (
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 space-y-2">
                                <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5"><Shield size={12} /> Baseline Counts Captured</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-secondary rounded-lg p-3 text-center">
                                        <div className="text-2xl font-bold text-foreground">{baselineCounts.workflows ?? '—'}</div>
                                        <div className="text-[11px] text-muted-foreground">Workflows</div>
                                    </div>
                                    <div className="bg-secondary rounded-lg p-3 text-center">
                                        <div className="text-2xl font-bold text-foreground">{baselineCounts.executions ?? '—'}</div>
                                        <div className="text-[11px] text-muted-foreground">Executions</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 p-3 rounded-lg text-xs flex items-start gap-2.5">
                        <AlertCircle size={14} className="shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold block mb-0.5">No URL Verified</span>
                            Baseline count fetching requires a verified instance URL. You can still register and counts will be captured from the first reporter sync.
                        </div>
                    </div>
                )}

                {registerError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400 flex items-center gap-2">
                        <AlertCircle size={13} className="shrink-0" />
                        <span>{registerError}</span>
                    </div>
                )}

                <div className="flex gap-2 mt-2">
                    <Button type="button" variant="secondary" onClick={() => setStep('details')} className="flex-1 justify-center">
                        Back
                    </Button>
                    <Button type="button" onClick={handleRegister} className="flex-1 justify-center" disabled={loading}>
                        {loading ? <><Loader2 size={14} className="animate-spin" /> Registering...</> : 'Register Instance'}
                    </Button>
                </div>
            </div>
        );
    }

    return null;
}

function CredentialsDisplay({ data, onClose }: any) {
    const [verificationStatus, setVerificationStatus] = useState<'pending' | 'connected' | 'checking'>('pending');
    const [downloaded, setDownloaded] = useState(false);

    // Use webhook URL returned by server (per-instance unique path)
    const webhookUrl = data.webhook_url;

    // Poll for heartbeat status
    useEffect(() => {
        const checkHeartbeat = async () => {
            try {
                const response = await authFetch(`/instances/${data.id}`);
                if (response.ok) {
                    const result = await response.json();
                    if (result.instance?.last_heartbeat) {
                        setVerificationStatus('connected');
                    }
                }
            } catch (e) {
                console.error('Error checking heartbeat:', e);
            }
        };

        // Check immediately and then every 5 seconds
        checkHeartbeat();
        const interval = setInterval(checkHeartbeat, 5000);
        return () => clearInterval(interval);
    }, [data.id]);

    const handleDownload = async () => {
        try {
            const response = await fetch('/reporter-workflow.json');
            const workflow = await response.json();

            // Replace placeholders with actual credentials
            let jsonString = JSON.stringify(workflow, null, 2);
            jsonString = jsonString.replace(/YOUR_INSTANCE_ID/g, data.id);
            jsonString = jsonString.replace(/YOUR_HMAC_SECRET/g, data.hmac_secret);
            jsonString = jsonString.replace(/YOUR_SENTINEL_URL/g, webhookUrl);
            jsonString = jsonString.replace(/YOUR_N8N_URL/g, data.base_url || '');

            // Create blob and download
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sentinel-reporter-${data.name.replace(/\s+/g, '-').toLowerCase()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setDownloaded(true);
        } catch (e) {
            console.error('Failed to download workflow', e);
            alert('Failed to generate workflow file.');
        }
    };

    return (
        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-2">
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-lg text-sm flex items-start gap-3">
                <Check className="shrink-0 mt-0.5" size={16} />
                <div>
                    <span className="font-bold block mb-1">Instance Registered!</span>
                    Complete the 3 steps below to connect your n8n instance.
                </div>
            </div>

            {/* Step 1: Download Workflow */}
            <div className="p-4 bg-secondary/50 rounded-lg border border-border space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">1</span>
                    <h4 className="text-sm font-semibold text-foreground">Download Reporter Workflow</h4>
                </div>
                <p className="text-xs text-muted-foreground pl-8">
                    This workflow is pre-configured with your credentials and handles all telemetry types (heartbeat, configuration, executions).
                </p>
                <div className="ml-8">
                    <CredentialField label="Webhook URL" value={webhookUrl} />
                </div>
                <div className="ml-8">
                    <Button
                        onClick={handleDownload}
                        className={`justify-center w-full border-0 text-xs ${downloaded ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
                    >
                        {downloaded ? <><Check size={14} /> Downloaded</> : <><FileJson size={14} /> Download Reporter Workflow</>}
                    </Button>
                </div>
            </div>

            {/* Step 2: Import & Activate */}
            <div className="p-4 bg-secondary/50 rounded-lg border border-border space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">2</span>
                    <h4 className="text-sm font-semibold text-foreground">Import & Activate in n8n</h4>
                </div>
                <ol className="text-xs text-muted-foreground list-decimal pl-8 space-y-1.5">
                    <li>Open your n8n instance workflow editor</li>
                    <li>Click <strong>⋮</strong> (menu) → <strong>Import from File</strong></li>
                    <li>Select the downloaded JSON file</li>
                    <li>n8n will prompt you to select your n8n API credential when you import the workflow.</li>
                    <li>Click <strong>Save</strong> and toggle the workflow to <strong>Active</strong></li>
                </ol>
            </div>

            {/* Step 3: Verify Connection */}
            <div className={`p-4 rounded-lg border space-y-3 ${verificationStatus === 'connected'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-secondary/50 border-border'
                }`}>
                <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center ${verificationStatus === 'connected'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-primary/10 text-primary'
                        }`}>3</span>
                    <h4 className="text-sm font-semibold text-foreground">Verify Connection</h4>
                </div>

                <p className="text-xs text-muted-foreground pl-8">
                    Once the workflow is active, Sentinel will detect the first heartbeat automatically.
                </p>
                {verificationStatus === 'connected' ? (
                    <div className="flex items-center gap-2 pl-8 text-emerald-400 text-sm">
                        <Check size={16} />
                        <span className="font-medium">Connected! First heartbeat received.</span>
                    </div>
                ) : (
                    <div className="pl-8 space-y-2">
                        <div className="flex items-center gap-2 text-amber-400 text-sm">
                            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                            <span>Awaiting first heartbeat...</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            The workflow runs every 5 minutes. You can also manually execute it once to verify immediately.
                        </p>
                    </div>
                )}
            </div>

            {/* Reference Credentials (Collapsed) */}
            <details className="group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-white transition-colors flex items-center gap-1">
                    <span className="group-open:rotate-90 transition-transform">▶</span>
                    View credentials (for manual configuration)
                </summary>
                <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                    <CredentialField label="Instance ID" value={data.id} />
                    <CredentialField label="HMAC Secret" value={data.hmac_secret} />
                </div>
            </details>

            <div className="pt-4 border-t border-border">
                <Button onClick={onClose} variant="secondary" className="w-full justify-center">
                    {verificationStatus === 'connected' ? 'Done' : 'Close & Check Later'}
                </Button>
            </div>
        </div>
    );
}

function CredentialField({ label, value }: any) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">{label}</label>
            <div className="flex gap-2">
                <code className="flex-1 bg-background border border-border text-foreground/80 p-3 rounded-lg text-xs font-mono overflow-x-auto">
                    {value}
                </code>
                <button onClick={copy} aria-label="Copy to clipboard" className="p-3 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors duration-150 border border-transparent hover:border-border">
                    {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                </button>
            </div>
        </div>
    );
}
