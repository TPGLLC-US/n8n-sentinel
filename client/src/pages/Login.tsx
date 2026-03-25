import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../lib/auth';
import { Lock, Mail } from 'lucide-react';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await login(email, password);
            navigate('/');
        } catch (err: any) {
            setError(err.message || 'Invalid credentials');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4 relative overflow-hidden">
            {/* Subtle background glow */}
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />

            <div className="mb-8 text-center relative z-10">
                <img src="/logo.svg" alt="n8n Sentinel" className="h-12 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Monitoring Dashboard</p>
            </div>

            <div className="bg-card rounded-lg border border-border w-full max-w-sm overflow-hidden relative z-10">
                <div className="px-6 pt-6 pb-2">
                    <h2 className="text-lg font-semibold text-foreground">Sign in</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Enter your credentials to continue</p>
                </div>
                <div className="p-6 pt-4">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm text-center border border-red-500/20">
                                {error}
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                                Email
                            </label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
                                <input
                                    type="email"
                                    required
                                    className="w-full bg-secondary border border-border rounded-md pl-9 pr-4 py-2 text-foreground text-sm focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                                    placeholder="admin@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                                Password
                            </label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
                                <input
                                    type="password"
                                    required
                                    className="w-full bg-secondary border border-border rounded-md pl-9 pr-4 py-2 text-foreground text-sm focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2 rounded-md text-sm transition-colors duration-150 disabled:opacity-50"
                        >
                            {loading ? 'Signing in...' : 'Sign in'}
                        </button>
                    </form>
                </div>
            </div>

            <p className="mt-6 text-xs text-muted-foreground/50 relative z-10">n8n Sentinel — Workflow Monitoring</p>
        </div>
    );
}
