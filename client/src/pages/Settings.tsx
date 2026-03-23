import { useEffect, useState } from 'react';
import { Mail, Save, CheckCircle2, Loader2, AlertTriangle, Send, Clock, CalendarDays, History, Trash2, Database, Bell } from 'lucide-react';
import { authFetch } from '../lib/auth';

export default function Settings() {
    // Email / Resend settings
    const [resendKey, setResendKey] = useState('');
    const [resendKeySet, setResendKeySet] = useState(false);
    const [fromEmail, setFromEmail] = useState('');
    const [recipients, setRecipients] = useState('');
    const [reportSchedule, setReportSchedule] = useState('none');
    const [dailyHour, setDailyHour] = useState('8');
    const [weeklyDay, setWeeklyDay] = useState('1');
    const [monthlyDay, setMonthlyDay] = useState('1');
    const [emailSaving, setEmailSaving] = useState(false);
    const [emailStatus, setEmailStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [testEmail, setTestEmail] = useState('');
    const [sending, setSending] = useState<string | null>(null);
    const [reportHistory, setReportHistory] = useState<any[]>([]);
    const [instanceBreakdown, setInstanceBreakdown] = useState(false);

    // Alert email settings
    const [alertEmailEnabled, setAlertEmailEnabled] = useState(false);
    const [alertEmailTypes, setAlertEmailTypes] = useState<Record<string, boolean>>({
        heartbeat_missed: true,
        error_rate_high: true,
        workflow_count_zero: true,
        workflow_count_drop: true,
        workflow_count_spike: false,
        instance_url_mismatch: true,
        reporter_outdated: false,
    });
    const [alertSaving, setAlertSaving] = useState(false);
    const [alertStatus, setAlertStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Data retention settings
    const [retentionExecDays, setRetentionExecDays] = useState('90');
    const [retentionAlertDays, setRetentionAlertDays] = useState('90');
    const [retentionTokenDays, setRetentionTokenDays] = useState('90');
    const [retentionSaving, setRetentionSaving] = useState(false);
    const [retentionStatus, setRetentionStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // AI settings
    const [anthropicKey, setAnthropicKey] = useState('');
    const [anthropicKeySet, setAnthropicKeySet] = useState(false);
    const [autoFixEnabled, setAutoFixEnabled] = useState(false);
    const [maxFixesPerDay, setMaxFixesPerDay] = useState('10');
    const [aiSaving, setAiSaving] = useState(false);
    const [aiStatus, setAiStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [loadingSettings, setLoadingSettings] = useState(true);

    useEffect(() => {
        Promise.all([
            authFetch('/settings').then(r => r.json()),
            authFetch('/reports/history?limit=5').then(r => r.json()),
        ])
            .then(([settingsData, historyData]) => {
                const s = settingsData.settings || {};
                if (s.anthropic_api_key) setAnthropicKeySet(s.anthropic_api_key.is_set);
                if (s.auto_fix_enabled) setAutoFixEnabled(s.auto_fix_enabled.value === 'true');
                if (s.max_fixes_per_day) setMaxFixesPerDay(s.max_fixes_per_day.value || '10');
                if (s.resend_api_key) setResendKeySet(s.resend_api_key.is_set);
                if (s.report_from_email?.value) setFromEmail(s.report_from_email.value);
                if (s.report_recipients?.value) setRecipients(s.report_recipients.value);
                if (s.report_schedule?.value) setReportSchedule(s.report_schedule.value);
                if (s.report_daily_hour?.value) setDailyHour(s.report_daily_hour.value);
                if (s.report_weekly_day?.value) setWeeklyDay(s.report_weekly_day.value);
                if (s.report_monthly_day?.value) setMonthlyDay(s.report_monthly_day.value);
                if (s.report_instance_breakdown?.value) setInstanceBreakdown(s.report_instance_breakdown.value === 'true');
                if (s.alert_email_enabled?.value) setAlertEmailEnabled(s.alert_email_enabled.value === 'true');
                if (s.alert_email_types?.value) {
                    const saved = s.alert_email_types.value.split(',').map((t: string) => t.trim());
                    setAlertEmailTypes(prev => {
                        const next = { ...prev };
                        Object.keys(next).forEach(k => { next[k] = saved.includes(k); });
                        return next;
                    });
                }
                if (s.retention_executions_days?.value) setRetentionExecDays(s.retention_executions_days.value);
                if (s.retention_alerts_days?.value) setRetentionAlertDays(s.retention_alerts_days.value);
                if (s.retention_token_usage_days?.value) setRetentionTokenDays(s.retention_token_usage_days.value);
                setReportHistory(historyData.reports || []);
            })
            .catch(console.error)
            .finally(() => setLoadingSettings(false));
    }, []);

    const saveEmailSettings = async () => {
        setEmailSaving(true);
        setEmailStatus(null);
        try {
            const updates: Record<string, string> = {
                report_from_email: fromEmail,
                report_recipients: recipients,
                report_schedule: reportSchedule,
                report_daily_hour: dailyHour,
                report_weekly_day: weeklyDay,
                report_monthly_day: monthlyDay,
                report_instance_breakdown: instanceBreakdown ? 'true' : 'false',
            };
            if (resendKey) updates.resend_api_key = resendKey;

            const res = await authFetch('/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            if (!res.ok) {
                const data = await res.json();
                setEmailStatus({ type: 'error', message: data.error || 'Failed to save' });
                return;
            }
            if (resendKey) { setResendKeySet(true); setResendKey(''); }
            // Refresh scheduler
            await authFetch('/reports/refresh-schedule', { method: 'POST' });
            setEmailStatus({ type: 'success', message: 'Email settings saved & scheduler updated' });
            setTimeout(() => setEmailStatus(null), 4000);
        } catch (err: any) {
            setEmailStatus({ type: 'error', message: err.message });
        } finally {
            setEmailSaving(false);
        }
    };

    const handleSendNow = async (period: 'daily' | 'weekly' | 'monthly') => {
        setSending(period);
        try {
            const res = await authFetch('/reports/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ period }),
            });
            const data = await res.json();
            if (data.success) {
                setEmailStatus({ type: 'success', message: `${period} report sent!` });
                // Refresh history
                const hist = await authFetch('/reports/history?limit=5').then(r => r.json());
                setReportHistory(hist.reports || []);
            } else {
                setEmailStatus({ type: 'error', message: data.error || 'Failed to send' });
            }
        } catch (err: any) {
            setEmailStatus({ type: 'error', message: err.message });
        } finally {
            setSending(null);
            setTimeout(() => setEmailStatus(null), 4000);
        }
    };

    const handleTestSend = async () => {
        if (!testEmail) return;
        setSending('test');
        try {
            const res = await authFetch('/reports/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ period: 'daily', email: testEmail }),
            });
            const data = await res.json();
            if (data.success) {
                setEmailStatus({ type: 'success', message: `Test report sent to ${testEmail}` });
            } else {
                setEmailStatus({ type: 'error', message: data.error || 'Failed to send test' });
            }
        } catch (err: any) {
            setEmailStatus({ type: 'error', message: err.message });
        } finally {
            setSending(null);
            setTimeout(() => setEmailStatus(null), 4000);
        }
    };

    const saveAlertSettings = async () => {
        setAlertSaving(true);
        setAlertStatus(null);
        try {
            const enabledTypes = Object.entries(alertEmailTypes).filter(([, v]) => v).map(([k]) => k).join(',');
            const res = await authFetch('/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    alert_email_enabled: alertEmailEnabled ? 'true' : 'false',
                    alert_email_types: enabledTypes,
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                setAlertStatus({ type: 'error', message: data.error || 'Failed to save' });
                return;
            }
            setAlertStatus({ type: 'success', message: 'Alert notification settings saved' });
            setTimeout(() => setAlertStatus(null), 4000);
        } catch (err: any) {
            setAlertStatus({ type: 'error', message: err.message });
        } finally {
            setAlertSaving(false);
        }
    };

    const saveRetentionSettings = async () => {
        setRetentionSaving(true);
        setRetentionStatus(null);
        try {
            const res = await authFetch('/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    retention_executions_days: retentionExecDays,
                    retention_alerts_days: retentionAlertDays,
                    retention_token_usage_days: retentionTokenDays,
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                setRetentionStatus({ type: 'error', message: data.error || 'Failed to save' });
                return;
            }
            setRetentionStatus({ type: 'success', message: 'Retention settings saved. Next cleanup at 02:00 UTC.' });
            setTimeout(() => setRetentionStatus(null), 4000);
        } catch (err: any) {
            setRetentionStatus({ type: 'error', message: err.message });
        } finally {
            setRetentionSaving(false);
        }
    };

    const saveAiSettings = async () => {
        setAiSaving(true);
        setAiStatus(null);
        try {
            const updates: Record<string, string> = {
                auto_fix_enabled: autoFixEnabled ? 'true' : 'false',
                max_fixes_per_day: maxFixesPerDay,
            };
            if (anthropicKey) {
                updates.anthropic_api_key = anthropicKey;
            }
            const res = await authFetch('/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            const data = await res.json();
            if (!res.ok) {
                setAiStatus({ type: 'error', message: data.error || 'Failed to save' });
            } else {
                if (anthropicKey) {
                    setAnthropicKeySet(true);
                    setAnthropicKey('');
                }
                setAiStatus({ type: 'success', message: 'Settings saved successfully' });
                setTimeout(() => setAiStatus(null), 3000);
            }
        } catch (err: any) {
            setAiStatus({ type: 'error', message: err.message });
        } finally {
            setAiSaving(false);
        }
    };

    return (
        <div className="space-y-8">
            <h1 className="text-2xl font-semibold text-foreground">Settings</h1>

            {/* AI Integration */}
            <div className="card rounded-lg overflow-hidden max-w-2xl">
                <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-base font-semibold text-foreground">AI Integration</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Configure AI-powered workflow auto-fixing via Anthropic Claude.</p>
                </div>

                {loadingSettings ? (
                    <div className="p-6 text-muted-foreground animate-pulse text-sm">Loading settings...</div>
                ) : (
                    <div className="p-6 space-y-6">
                        {/* Anthropic API Key */}
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">
                                Anthropic API Key
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="password"
                                    className="flex-1 bg-secondary border border-border rounded-lg px-4 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                                    placeholder={anthropicKeySet ? '••••••••••••••••••••••••' : 'sk-ant-...'}
                                    value={anthropicKey}
                                    onChange={e => setAnthropicKey(e.target.value)}
                                />
                                {anthropicKeySet && !anthropicKey && (
                                    <div className="flex items-center gap-1 text-emerald-400 text-xs px-3">
                                        <CheckCircle2 size={14} /> Configured
                                    </div>
                                )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1.5">
                                Encrypted at rest. Get your key from console.anthropic.com
                            </p>
                        </div>

                        {/* Save + Status */}
                        <div className="flex items-center gap-3 pt-4">
                            <button
                                onClick={saveAiSettings}
                                disabled={aiSaving}
                                className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors duration-150 disabled:opacity-50"
                            >
                                {aiSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Save AI Settings
                            </button>
                            {aiStatus && (
                                <span className={`text-xs flex items-center gap-1 ${aiStatus.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {aiStatus.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                                    {aiStatus.message}
                                </span>
                            )}
                        </div>

                        {!anthropicKeySet && (
                            <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-3 text-xs text-amber-400/80 flex items-start gap-2">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                <div>
                                    <div className="font-medium">API key required</div>
                                    <div className="text-amber-400/60 mt-0.5">AI workflow fixing requires an Anthropic API key. Each instance also needs an n8n API key configured in its settings.</div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Email Reports */}
            <div className="card rounded-lg overflow-hidden max-w-2xl">
                <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-base font-semibold text-foreground flex items-center gap-2"><Mail size={18} /> Email Reports</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Configure Resend-powered monitoring reports delivered to your inbox.</p>
                </div>

                {loadingSettings ? (
                    <div className="p-6 text-muted-foreground animate-pulse text-sm">Loading settings...</div>
                ) : (
                    <div className="p-6 space-y-6">
                        {/* Resend API Key */}
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">Resend API Key</label>
                            <div className="flex gap-2">
                                <input
                                    type="password"
                                    className="flex-1 bg-secondary border border-border rounded-lg px-4 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                                    placeholder={resendKeySet ? '••••••••••••••••••••••••' : 're_...'}
                                    value={resendKey}
                                    onChange={e => setResendKey(e.target.value)}
                                />
                                {resendKeySet && !resendKey && (
                                    <div className="flex items-center gap-1 text-emerald-400 text-xs px-3">
                                        <CheckCircle2 size={14} /> Configured
                                    </div>
                                )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1.5">Encrypted at rest. Get your key from resend.com/api-keys</p>
                        </div>

                        {/* From Email */}
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">From Email</label>
                            <input
                                className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                                placeholder="Sentinel <reports@yourdomain.com>"
                                value={fromEmail}
                                onChange={e => setFromEmail(e.target.value)}
                            />
                            <p className="text-[11px] text-muted-foreground mt-1.5">Must be from a verified Resend domain</p>
                        </div>

                        {/* Recipients */}
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">Recipients</label>
                            <input
                                className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                                placeholder="admin@example.com, team@example.com"
                                value={recipients}
                                onChange={e => setRecipients(e.target.value)}
                            />
                            <p className="text-[11px] text-muted-foreground mt-1.5">Comma-separated email addresses</p>
                        </div>

                        {/* Schedule */}
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><Clock size={14} /> Report Schedule</label>
                            <div className="flex flex-wrap gap-2">
                                {['none', 'daily', 'weekly', 'monthly', 'daily,weekly', 'daily,weekly,monthly'].map(opt => (
                                    <button
                                        key={opt}
                                        onClick={() => setReportSchedule(opt)}
                                        className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                                            reportSchedule === opt
                                                ? 'bg-primary text-white border-primary'
                                                : 'bg-secondary text-muted-foreground border-border hover:border-primary/30'
                                        }`}
                                    >
                                        {opt === 'none' ? 'Off' : opt.split(',').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' + ')}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Schedule Details */}
                        {reportSchedule !== 'none' && (
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs text-muted-foreground mb-1">Send Hour (UTC)</label>
                                    <select
                                        className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                                        value={dailyHour}
                                        onChange={e => setDailyHour(e.target.value)}
                                    >
                                        {Array.from({ length: 24 }, (_, i) => (
                                            <option key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</option>
                                        ))}
                                    </select>
                                </div>
                                {reportSchedule.includes('weekly') && (
                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Weekly Day</label>
                                        <select
                                            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                                            value={weeklyDay}
                                            onChange={e => setWeeklyDay(e.target.value)}
                                        >
                                            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                                                <option key={i} value={String(i)}>{d}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                {reportSchedule.includes('monthly') && (
                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Monthly Day</label>
                                        <select
                                            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                                            value={monthlyDay}
                                            onChange={e => setMonthlyDay(e.target.value)}
                                        >
                                            {Array.from({ length: 28 }, (_, i) => (
                                                <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Instance Breakdown Toggle */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <CalendarDays size={18} className="text-violet-400" />
                                <div>
                                    <div className="font-medium text-foreground">Include Per-Instance Breakdown</div>
                                    <div className="text-sm text-muted-foreground">Break down stats by each monitored n8n instance in reports</div>
                                </div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" className="sr-only peer" checked={instanceBreakdown} onChange={(e) => setInstanceBreakdown(e.target.checked)} />
                                <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-transparent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-transparent after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>

                        {/* Save + Status */}
                        <div className="flex items-center gap-3 pt-2">
                            <button
                                onClick={saveEmailSettings}
                                disabled={emailSaving}
                                className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors duration-150 disabled:opacity-50"
                            >
                                {emailSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Save Email Settings
                            </button>
                            {emailStatus && (
                                <span className={`text-xs flex items-center gap-1 ${emailStatus.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {emailStatus.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                                    {emailStatus.message}
                                </span>
                            )}
                        </div>

                        {/* Send Now / Test */}
                        {resendKeySet && (
                            <>
                                <hr className="border-border" />
                                <div>
                                    <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><Send size={14} /> Send Report Now</label>
                                    <div className="flex gap-2 flex-wrap">
                                        {(['daily', 'weekly', 'monthly'] as const).map(p => (
                                            <button
                                                key={p}
                                                onClick={() => handleSendNow(p)}
                                                disabled={!!sending}
                                                className="px-3 py-1.5 text-xs rounded-md border bg-violet-500/10 text-violet-400 border-violet-500/20 hover:bg-violet-500/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                            >
                                                {sending === p ? <Loader2 size={12} className="animate-spin" /> : <CalendarDays size={12} />}
                                                {p.charAt(0).toUpperCase() + p.slice(1)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-muted-foreground mb-2">Send Test Email</label>
                                    <div className="flex gap-2">
                                        <input
                                            className="flex-1 bg-secondary border border-border rounded-lg px-4 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                                            placeholder="your@email.com"
                                            value={testEmail}
                                            onChange={e => setTestEmail(e.target.value)}
                                        />
                                        <button
                                            onClick={handleTestSend}
                                            disabled={!testEmail || !!sending}
                                            className="px-4 py-2 text-xs rounded-lg border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                                        >
                                            {sending === 'test' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                            Send Test
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}

                        {!resendKeySet && (
                            <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-3 text-xs text-amber-400/80 flex items-start gap-2">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                <div>
                                    <div className="font-medium">Resend API key required</div>
                                    <div className="text-amber-400/60 mt-0.5">Email reports require a Resend API key. Sign up at resend.com and add a verified domain.</div>
                                </div>
                            </div>
                        )}

                        {/* Recent Report History */}
                        {reportHistory.length > 0 && (
                            <>
                                <hr className="border-border" />
                                <div>
                                    <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><History size={14} /> Recent Reports</label>
                                    <div className="space-y-2">
                                        {reportHistory.map((r: any) => (
                                            <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-secondary/50 border border-border text-xs">
                                                <div className="flex items-center gap-2">
                                                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium border ${
                                                        r.status === 'sent'
                                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                                                    }`}>{r.status}</span>
                                                    <span className="text-foreground font-medium">{r.period}</span>
                                                    <span className="text-muted-foreground">via {r.triggered_by}</span>
                                                </div>
                                                <span className="text-muted-foreground">{new Date(r.sent_at).toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
            {/* Alert Notifications */}
            <div className="card rounded-lg overflow-hidden max-w-2xl">
                <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-base font-semibold text-foreground flex items-center gap-2"><Bell size={18} /> Alert Email Notifications</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Receive email notifications when alerts are triggered. Uses the same Resend API key and recipients configured above.</p>
                </div>

                {loadingSettings ? (
                    <div className="p-6 text-muted-foreground animate-pulse text-sm">Loading settings...</div>
                ) : (
                    <div className="p-6 space-y-6">
                        {/* Master Toggle */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Bell size={18} className="text-violet-400" />
                                <div>
                                    <div className="font-medium text-foreground">Enable Alert Emails</div>
                                    <div className="text-sm text-muted-foreground">Send email when new alerts are created</div>
                                </div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" className="sr-only peer" checked={alertEmailEnabled} onChange={e => setAlertEmailEnabled(e.target.checked)} />
                                <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-transparent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-transparent after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>

                        {/* Per-Type Toggles */}
                        {alertEmailEnabled && (
                            <div className="space-y-3 pl-1">
                                <label className="block text-xs font-medium text-muted-foreground mb-2">Alert Types to Notify</label>
                                {([
                                    { key: 'heartbeat_missed', label: 'Missed Heartbeat', desc: 'Instance stops reporting', severity: 'warning' },
                                    { key: 'error_rate_high', label: 'High Error Rate', desc: 'Error rate exceeds threshold', severity: 'warning' },
                                    { key: 'workflow_count_zero', label: 'Zero Workflows', desc: 'All workflows deleted', severity: 'critical' },
                                    { key: 'workflow_count_drop', label: 'Workflow Count Drop', desc: 'Significant workflow count decrease', severity: 'warning' },
                                    { key: 'workflow_count_spike', label: 'Workflow Count Spike', desc: 'Unusual workflow count increase', severity: 'info' },
                                    { key: 'instance_url_mismatch', label: 'Instance URL Mismatch', desc: 'Reporter running on different URL', severity: 'critical' },
                                    { key: 'reporter_outdated', label: 'Reporter Outdated', desc: 'Reporter version behind latest', severity: 'warning' },
                                ] as const).map(({ key, label, desc, severity }) => (
                                    <div key={key} className="flex items-center justify-between py-2 px-3 rounded-md bg-secondary/30 border border-border">
                                        <div className="flex items-center gap-3">
                                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                                severity === 'critical' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                severity === 'warning' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                                'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                            }`}>{severity}</span>
                                            <div>
                                                <div className="text-sm font-medium text-foreground">{label}</div>
                                                <div className="text-[11px] text-muted-foreground">{desc}</div>
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={alertEmailTypes[key]}
                                                onChange={e => setAlertEmailTypes(prev => ({ ...prev, [key]: e.target.checked }))}
                                            />
                                            <div className="w-9 h-5 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-transparent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-transparent after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                        </label>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Save */}
                        <div className="flex items-center gap-3 pt-2">
                            <button
                                onClick={saveAlertSettings}
                                disabled={alertSaving}
                                className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors duration-150 disabled:opacity-50"
                            >
                                {alertSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Save Alert Settings
                            </button>
                            {alertStatus && (
                                <span className={`text-xs flex items-center gap-1 ${alertStatus.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {alertStatus.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                                    {alertStatus.message}
                                </span>
                            )}
                        </div>

                        {!resendKeySet && (
                            <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-3 text-xs text-amber-400/80 flex items-start gap-2">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                <div>
                                    <div className="font-medium">Resend API key required</div>
                                    <div className="text-amber-400/60 mt-0.5">Alert emails use the same Resend API key and recipients from Email Reports above.</div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            {/* Data Retention */}
            <div className="card rounded-lg overflow-hidden max-w-2xl">
                <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-base font-semibold text-foreground flex items-center gap-2"><Database size={18} /> Data Retention</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Configure how long data is kept before automatic cleanup. Daily metrics are preserved indefinitely.</p>
                </div>

                {loadingSettings ? (
                    <div className="p-6 text-muted-foreground animate-pulse text-sm">Loading settings...</div>
                ) : (
                    <div className="p-6 space-y-6">
                        {/* Executions */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                                    <Trash2 size={14} /> Executions & Token Usage
                                </label>
                                <span className="text-sm font-mono text-foreground">{retentionExecDays} days</span>
                            </div>
                            <input
                                type="range"
                                min="10"
                                max="90"
                                step="5"
                                value={retentionExecDays}
                                onChange={e => { setRetentionExecDays(e.target.value); setRetentionTokenDays(e.target.value); }}
                                className="w-full accent-primary"
                            />
                            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                                <span>10 days</span>
                                <span>90 days</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">Execution history and associated token usage records. Aggregated daily metrics are preserved.</p>
                        </div>

                        {/* Alerts */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                                    <AlertTriangle size={14} /> Acknowledged Alerts
                                </label>
                                <span className="text-sm font-mono text-foreground">{retentionAlertDays} days</span>
                            </div>
                            <input
                                type="range"
                                min="10"
                                max="90"
                                step="5"
                                value={retentionAlertDays}
                                onChange={e => setRetentionAlertDays(e.target.value)}
                                className="w-full accent-primary"
                            />
                            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                                <span>10 days</span>
                                <span>90 days</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">Only acknowledged alerts are cleaned up. Active alerts are never deleted.</p>
                        </div>

                        {/* Save */}
                        <div className="flex items-center gap-3 pt-2">
                            <button
                                onClick={saveRetentionSettings}
                                disabled={retentionSaving}
                                className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors duration-150 disabled:opacity-50"
                            >
                                {retentionSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Save Retention Settings
                            </button>
                            {retentionStatus && (
                                <span className={`text-xs flex items-center gap-1 ${retentionStatus.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {retentionStatus.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                                    {retentionStatus.message}
                                </span>
                            )}
                        </div>

                        <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-3 text-xs text-blue-400/80 flex items-start gap-2">
                            <Clock size={14} className="shrink-0 mt-0.5" />
                            <div>
                                <div className="font-medium">Cleanup runs daily at 02:00 UTC</div>
                                <div className="text-blue-400/60 mt-0.5">Before deletion, execution data is aggregated into daily metrics which are kept indefinitely for long-term reporting.</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
