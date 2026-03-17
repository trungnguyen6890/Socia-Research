'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const { token, isReady, login } = useAuth();
  const [apiUrl, setApiUrl] = useState('https://socia-research.trungnguyen6890.workers.dev');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[13px] text-neutral-400">Loading…</p>
      </div>
    );
  }

  if (token) {
    return <>{children}</>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const ok = await login(apiUrl.replace(/\/$/, ''), password);
    setLoading(false);
    if (!ok) setError('Invalid password or API unreachable');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm">
        <div className="border border-neutral-200 rounded-lg bg-white px-6 py-8">
          <h1 className="text-[15px] font-semibold text-neutral-900 mb-1">Socia Research</h1>
          <p className="text-[12px] text-neutral-400 mb-6">Sign in to access the dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[12px] text-neutral-500 block mb-1">API URL</label>
              <input
                type="url"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="w-full text-[13px] px-3 py-2 border border-neutral-200 rounded-md bg-white text-neutral-700 placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400"
                placeholder="https://your-worker.workers.dev"
              />
            </div>
            <div>
              <label className="text-[12px] text-neutral-500 block mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
                className="w-full text-[13px] px-3 py-2 border border-neutral-200 rounded-md bg-white text-neutral-700 placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400"
                placeholder="Admin password"
              />
            </div>

            {error && (
              <p className="text-[12px] text-red-500">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-[13px] px-4 py-2 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Connecting…' : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="text-[11px] text-neutral-400 text-center mt-4">
          Password is stored locally in your browser
        </p>
      </div>
    </div>
  );
}
