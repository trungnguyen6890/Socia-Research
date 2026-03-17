import type {
  Source, Keyword, Goal, ContentItem, RunLog,
  Schedule, Settings, DashboardStats,
} from './types';

// ─── Runtime auth ───────────────────────────────────────────────────────────

function getAuth(): { apiBase: string; token: string } {
  if (typeof window === 'undefined') return { apiBase: '', token: '' };
  try {
    const saved = localStorage.getItem('socia_auth');
    if (saved) {
      const { token, apiBase } = JSON.parse(saved);
      return { apiBase: apiBase || '', token: token || '' };
    }
  } catch {}
  return { apiBase: '', token: '' };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { apiBase, token } = getAuth();
  if (!apiBase || !token) throw new Error('Not authenticated');

  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
    cache: 'no-store',
  });
  if (res.status === 401) {
    // Clear auth and reload
    localStorage.removeItem('socia_auth');
    window.location.reload();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ─── API Functions ──────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  return apiFetch('/api/stats');
}

export async function getSources(): Promise<Source[]> {
  return apiFetch('/api/sources');
}

export async function getKeywords(): Promise<Keyword[]> {
  return apiFetch('/api/keywords');
}

export async function getGoals(): Promise<Goal[]> {
  return apiFetch('/api/goals');
}

export async function getContent(filters?: {
  sourceId?: string; search?: string; minScore?: number; page?: number;
}): Promise<{ items: ContentItem[]; total: number }> {
  const params = new URLSearchParams();
  if (filters?.sourceId) params.set('source_id', filters.sourceId);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.minScore) params.set('min_score', String(filters.minScore));
  if (filters?.page) params.set('page', String(filters.page));
  const qs = params.toString();
  return apiFetch(`/api/content${qs ? `?${qs}` : ''}`);
}

export async function getRecentRuns(): Promise<RunLog[]> {
  return apiFetch('/api/runs');
}

export async function getSettings(): Promise<Settings> {
  return apiFetch('/api/settings');
}

export async function updateSettings(settings: Partial<Settings>): Promise<void> {
  await apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

export async function getSchedules(): Promise<Schedule[]> {
  return apiFetch('/api/schedules');
}

export interface RunResult {
  status: 'success' | 'error' | 'skipped';
  itemsFetched?: number;
  totalFetched?: number;
  duplicates?: number;
  filtered?: number;
  reason?: string;
  error?: string;
}

export async function runSource(sourceId: string): Promise<RunResult> {
  return apiFetch(`/api/sources/${sourceId}/run`, { method: 'POST' });
}

export async function createSource(data: Partial<Source>): Promise<Source> {
  return apiFetch('/api/sources', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSource(sourceId: string, data: Partial<Source>): Promise<Source> {
  return apiFetch(`/api/sources/${sourceId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function toggleSource(sourceId: string): Promise<{ id: string; is_active: number }> {
  return apiFetch(`/api/sources/${sourceId}/toggle`, { method: 'POST' });
}

export async function deleteSource(sourceId: string): Promise<void> {
  await apiFetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
}
