'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface AuthCtx {
  token: string | null;
  apiBase: string;
  login: (apiBase: string, password: string) => Promise<boolean>;
  logout: () => void;
  isReady: boolean;
}

const AuthContext = createContext<AuthCtx>({
  token: null,
  apiBase: '',
  login: async () => false,
  logout: () => {},
  isReady: false,
});

export function useAuth() {
  return useContext(AuthContext);
}

const STORAGE_KEY = 'socia_auth';
const DEFAULT_API = 'https://socia-research.trungnguyen6890.workers.dev';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [apiBase, setApiBase] = useState(DEFAULT_API);
  const [isReady, setIsReady] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { token: t, apiBase: a } = JSON.parse(saved);
        if (t) setToken(t);
        if (a) setApiBase(a);
      }
    } catch {}
    setIsReady(true);
  }, []);

  const login = async (base: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch(`${base}/api/stats`, {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (res.ok) {
        setToken(password);
        setApiBase(base);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: password, apiBase: base }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ token, apiBase, login, logout, isReady }}>
      {children}
    </AuthContext.Provider>
  );
}
