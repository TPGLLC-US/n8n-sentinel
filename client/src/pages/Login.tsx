import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../lib/auth';
import { Activity, Lock, Mail } from 'lucide-react';

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
        <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
            <div className="mb-8 text-center">
                <div className="mx-auto w-10 h-10 bg-primary rounded-lg flex items-center justify-center mb-4">
                    <Activity size={22} className="text-white" />
                </div>
                <h1 className="text-2xl font-semibold text-foreground">n8n Sentinel</h1>
            </div>

            <div className="bg-card rounded-lg border border-border w-full max-w-sm overflow-hidden">
                <div className="p-6">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm text-center border border-red-500/20">
                                {error}
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">
                                Email
                            </label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
                                <input
                                    type="email"
                                    required
                                    className="w-full bg-secondary border border-border rounded-lg pl-9 pr-4 py-2 text-foreground focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                                    placeholder="admin@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">
                                Password
                            </label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
                                <input
                                    type="password"
                                    required
                                    className="w-full bg-secondary border border-border rounded-lg pl-9 pr-4 py-2 text-foreground focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors placeholder:text-muted-foreground/50"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2 rounded-lg transition-colors duration-150 disabled:opacity-50"
                        >
                            {loading ? 'Signing in...' : 'Sign in'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
