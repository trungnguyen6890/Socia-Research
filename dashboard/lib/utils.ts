export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
  } catch { return s; }
}

export function fmtRelative(s: string | null | undefined): string {
  if (!s) return '—';
  const diff = Date.now() - new Date(s).getTime();
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function truncate(s: string | null | undefined, n = 120): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function jsonSafe<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export const CONNECTOR_COLORS: Record<string, string> = {
  rss: 'bg-orange-50 text-orange-700',
  website: 'bg-blue-50 text-blue-700',
  youtube: 'bg-red-50 text-red-700',
  x_browser: 'bg-violet-50 text-violet-700',
  telegram: 'bg-sky-50 text-sky-700',
  facebook_page: 'bg-indigo-50 text-indigo-700',
  facebook_browser: 'bg-indigo-50 text-indigo-700',
  instagram_pro: 'bg-pink-50 text-pink-700',
  tiktok: 'bg-neutral-900 text-white',
  tiktok_watch: 'bg-neutral-100 text-neutral-700',
  threads_watch: 'bg-neutral-100 text-neutral-700',
};
