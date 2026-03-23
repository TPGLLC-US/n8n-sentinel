import { Link, Outlet, useLocation } from 'react-router-dom';
import { Activity, Server, FileJson, Play, Database, BarChart3, Settings, LogOut, Coins, AlertTriangle } from 'lucide-react';
import { logout } from '../lib/auth';

export default function Layout() {
    const location = useLocation();

    const navItem = (path: string, icon: any, label: string) => {
        const isActive = location.pathname === path || (path !== '/' && location.pathname.startsWith(path));
        return (
            <Link
                to={path}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors duration-150 relative ${isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
            >
                {isActive && (
                    <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-r" />
                )}
                {icon}
                <span className="font-medium">{label}</span>
            </Link>
        );
    };

    return (
        <div className="min-h-screen bg-background text-foreground flex font-sans">
            {/* Sidebar */}
            <aside className="w-64 bg-card border-r border-border flex flex-col fixed h-full z-10">
                <div className="px-5 py-5 flex items-center">
                    <img src="/logo.svg" alt="n8n Sentinel" className="h-12" />
                </div>

                <div className="mx-4 mb-3">
                    <div className="h-px bg-border" />
                </div>

                <nav className="flex-1 px-3 space-y-0.5">
                    {navItem('/', <BarChart3 size={18} />, 'Overview')}
                    {navItem('/alerts', <Activity size={18} />, 'Alerts')}

                    <div className="pt-5 pb-1.5 px-3">
                        <span className="text-[11px] font-medium text-muted-foreground">Discovery</span>
                    </div>
                    {navItem('/instances', <Server size={18} />, 'Instances')}
                    {navItem('/workflows', <FileJson size={18} />, 'Workflows')}
                    {navItem('/executions', <Play size={18} />, 'Executions')}
                    {navItem('/resources', <Database size={18} />, 'Resources')}
                    {navItem('/tokens', <Coins size={18} />, 'Token Usage')}
                    {navItem('/error-reporting', <AlertTriangle size={18} />, 'Error Reporting')}
                </nav>

                <div className="px-3 py-3 mx-3 mb-3 border-t border-border flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Admin</span>
                    <div className="flex gap-1">
                        <Link to="/settings" className="p-1.5 text-muted-foreground hover:text-foreground rounded-md transition-colors duration-150">
                            <Settings size={16} />
                        </Link>
                        <button
                            onClick={logout}
                            className="p-1.5 text-muted-foreground hover:text-red-400 rounded-md transition-colors duration-150"
                            title="Logout"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 ml-64">
                <main className="p-8 max-w-7xl mx-auto">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
