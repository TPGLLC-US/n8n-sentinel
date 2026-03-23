import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';

import { authFetch } from '../lib/auth';

export default function Alerts() {
    const [alerts, setAlerts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchAlerts = async () => {
        try {
            const res = await authFetch('/alerts');
            const data = await res.json();
            setAlerts(data.alerts);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAlerts();
        const interval = setInterval(fetchAlerts, 10000);
        return () => clearInterval(interval);
    }, []);

    const resolve = async (id: string) => {
        try {
            await authFetch(`/alerts/${id}/acknowledge`, { method: 'POST' });
            fetchAlerts(); // Refresh
        } catch (error) {
            alert('Failed to resolve alert');
        }
    };

    if (loading) return <div className="p-8">Loading...</div>;

    return (
        <div>
            <h1 className="text-2xl font-semibold text-foreground mb-6">Alerts</h1>

            {alerts.length === 0 ? (
                <div className="card p-8 rounded-lg text-center">
                    <CheckCircle className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
                    <p className="text-sm text-muted-foreground">No active alerts.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {alerts.map((alert: any) => (
                        <div key={alert.id} className="card border-l-2 border-red-500 rounded-lg p-4 flex justify-between items-start">
                            <div className="flex gap-3">
                                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="text-sm font-semibold text-foreground">{alert.alert_type.replace('_', ' ').toUpperCase()}</h4>
                                    <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                                    <div className="mt-2 text-xs text-muted-foreground">
                                        Instance: {alert.instance_name || 'Unknown'} · {new Date(alert.triggered_at).toLocaleString()}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => resolve(alert.id)}
                                className="px-3 py-1.5 bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground text-xs rounded-md font-medium transition-colors duration-150 border border-border"
                            >
                                Acknowledge
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
