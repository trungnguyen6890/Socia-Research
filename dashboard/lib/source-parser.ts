export interface ParsedSource {
  name: string;
  connector_type: string;
  source_mode: string;
  url_or_handle: string;
  raw_input: string;
  confidence: 'high' | 'medium' | 'low';
}

const CONNECTOR_MODE: Record<string, string> = {
  x_browser: 'manual_watch',
  youtube: 'official_api',
  facebook_page: 'official_api',
  facebook_browser: 'manual_watch',
  instagram_pro: 'provider_api',
  tiktok_watch: 'manual_watch',
  telegram: 'manual_watch',
  threads_watch: 'manual_watch',
  rss: 'rss',
  website: 'website_parse',
};

function toName(raw: string): string {
  return raw
    .replace(/^@/, '')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
    .slice(0, 60);
}

function extractHandle(url: URL, prefix = ''): string {
  const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
  const slug = parts[0] ?? '';
  return prefix + slug.replace(/^@/, '');
}

export function parseSourceInput(raw: string): ParsedSource | null {
  const line = raw.trim();
  if (!line) return null;

  // ── Try parsing as URL ────────────────────────────────────────────────────
  let url: URL | null = null;
  try {
    url = new URL(line.startsWith('http') ? line : `https://${line}`);
  } catch {
    // not a URL — treat as plain handle
  }

  if (url) {
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    // X / Twitter
    if (host === 'x.com' || host === 'twitter.com') {
      const handle = extractHandle(url);
      if (!handle) return null;
      return {
        name: toName(handle),
        connector_type: 'x_browser',
        source_mode: CONNECTOR_MODE.x_browser,
        url_or_handle: handle,
        raw_input: line,
        confidence: 'high',
      };
    }

    // YouTube
    if (host === 'youtube.com' || host === 'youtu.be') {
      const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
      let handle = '';
      if (parts[0] === 'channel' && parts[1]) handle = parts[1];
      else if (parts[0] === 'user' && parts[1]) handle = parts[1];
      else if (parts[0]?.startsWith('@')) handle = parts[0].slice(1);
      else if (parts[0] === 'c' && parts[1]) handle = parts[1];
      else handle = parts[0] ?? '';
      if (!handle) return null;
      return {
        name: toName(handle),
        connector_type: 'youtube',
        source_mode: CONNECTOR_MODE.youtube,
        url_or_handle: url.pathname.replace(/^\//, '').split('?')[0],
        raw_input: line,
        confidence: 'high',
      };
    }

    // Facebook
    if (host === 'facebook.com' || host === 'fb.com') {
      const handle = extractHandle(url);
      if (!handle || handle === 'pages' || handle === 'groups') return null;
      const urlParts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
      const slug = urlParts[0] === 'pages' ? urlParts[2] ?? urlParts[1] : urlParts[0];
      return {
        name: toName(slug ?? handle),
        connector_type: 'facebook_browser',
        source_mode: 'manual_watch',
        url_or_handle: slug ?? handle,
        raw_input: line,
        confidence: 'high',
      };
    }

    // Instagram
    if (host === 'instagram.com') {
      const handle = extractHandle(url);
      if (!handle) return null;
      return {
        name: toName(handle),
        connector_type: 'instagram_pro',
        source_mode: CONNECTOR_MODE.instagram_pro,
        url_or_handle: handle,
        raw_input: line,
        confidence: 'high',
      };
    }

    // TikTok
    if (host === 'tiktok.com') {
      const handle = extractHandle(url).replace(/^@/, '');
      if (!handle) return null;
      return {
        name: toName(handle),
        connector_type: 'tiktok_watch',
        source_mode: CONNECTOR_MODE.tiktok_watch,
        url_or_handle: `@${handle}`,
        raw_input: line,
        confidence: 'high',
      };
    }

    // Telegram
    if (host === 't.me' || host === 'telegram.me' || host === 'telegram.org') {
      const handle = extractHandle(url);
      if (!handle) return null;
      return {
        name: toName(handle),
        connector_type: 'telegram',
        source_mode: CONNECTOR_MODE.telegram,
        url_or_handle: handle,
        raw_input: line,
        confidence: 'high',
      };
    }

    // Threads
    if (host === 'threads.net') {
      const handle = extractHandle(url).replace(/^@/, '');
      if (!handle) return null;
      return {
        name: toName(handle),
        connector_type: 'threads_watch',
        source_mode: CONNECTOR_MODE.threads_watch,
        url_or_handle: handle,
        raw_input: line,
        confidence: 'high',
      };
    }

    // RSS / Atom feed
    const path = url.pathname.toLowerCase();
    if (
      path.endsWith('.xml') ||
      path.endsWith('.rss') ||
      path.endsWith('.atom') ||
      path.includes('/rss') ||
      path.includes('/feed') ||
      path.includes('/atom') ||
      url.searchParams.has('format=rss') ||
      url.searchParams.get('feed') !== null
    ) {
      const siteName = host.replace(/\.[^.]+$/, '');
      return {
        name: toName(siteName) + ' RSS',
        connector_type: 'rss',
        source_mode: CONNECTOR_MODE.rss,
        url_or_handle: line,
        raw_input: line,
        confidence: 'high',
      };
    }

    // Generic website
    const siteName = host.replace(/\.[^.]+$/, '');
    return {
      name: toName(siteName),
      connector_type: 'website',
      source_mode: CONNECTOR_MODE.website,
      url_or_handle: line,
      raw_input: line,
      confidence: 'medium',
    };
  }

  // ── Plain handle (no URL) ─────────────────────────────────────────────────

  // @username → X
  if (line.startsWith('@') && !line.includes('/') && !line.includes('.')) {
    const handle = line.slice(1);
    return {
      name: toName(handle),
      connector_type: 'x_browser',
      source_mode: CONNECTOR_MODE.x_browser,
      url_or_handle: handle,
      raw_input: line,
      confidence: 'medium',
    };
  }

  // t/channel or tg/channel → Telegram
  if (/^(t|tg)\/\S+/.test(line)) {
    const handle = line.split('/')[1];
    return {
      name: toName(handle),
      connector_type: 'telegram',
      source_mode: CONNECTOR_MODE.telegram,
      url_or_handle: handle,
      raw_input: line,
      confidence: 'medium',
    };
  }

  return null;
}

export function parseSourcesFromText(text: string): ParsedSource[] {
  const lines = text
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const results: ParsedSource[] = [];
  for (const line of lines) {
    const parsed = parseSourceInput(line);
    if (parsed) results.push(parsed);
  }
  return results;
}

export const CONNECTOR_LABEL: Record<string, string> = {
  x_browser: 'X (Browser)',
  youtube: 'YouTube',
  facebook_page: 'Facebook (API)',
  facebook_browser: 'Facebook (Browser)',
  instagram_pro: 'Instagram',
  tiktok_watch: 'TikTok',
  telegram: 'Telegram',
  threads_watch: 'Threads',
  rss: 'RSS',
  website: 'Website',
};
