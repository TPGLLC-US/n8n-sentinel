const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const login = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    if (res.status === 429) {
        throw new Error('Too many login attempts. Try again in 1 minute.');
    }
    if (!res.ok) {
        throw new Error('Invalid credentials');
    }

    const data = await res.json();
    localStorage.setItem('token', data.token);
    if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken);
    }
    return data.token;
};

export const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    // Best-effort revoke on server
    try {
        await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
        });
    } catch { /* ignore */ }
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    window.location.href = '/login';
};

export const getToken = () => {
    return localStorage.getItem('token');
};

export const isAuthenticated = () => {
    return !!getToken();
};

async function refreshAccessToken(): Promise<string | null> {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return null;

    try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        localStorage.setItem('token', data.token);
        return data.token;
    } catch {
        return null;
    }
}

export const authFetch = async (url: string, options: any = {}) => {
    const token = getToken();
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };

    let res = await fetch(`${API_BASE}${url}`, { ...options, headers });

    // If 401, try refresh once
    if (res.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) {
            headers['Authorization'] = `Bearer ${newToken}`;
            res = await fetch(`${API_BASE}${url}`, { ...options, headers });
        }
        if (res.status === 401) {
            logout();
        }
    }

    return res;
};
