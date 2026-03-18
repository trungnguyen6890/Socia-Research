/**
 * Auto-detect the appropriate connector type for a given URL or handle.
 *
 * Detection order:
 *   1. URL pattern matching (no network) — YouTube, X, Telegram, Facebook, etc.
 *   2. Try the URL itself as RSS/Atom feed
 *   3. Try common RSS paths (/rss, /feed, /rss.xml, …)
 *   4. Fetch the page and analyze HTML structure
 */

export type DetectResult = {
  connector_type: string;
  url_or_handle: string;
  source_mode: string;
  config: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  note: string;
};

const RSS_PATHS = ['/rss', '/feed', '/rss.xml', '/atom.xml', '/feed.xml', '/rss/', '/feeds/posts/default', '/tin-tuc.rss'];
const RSS_CONTENT_TYPES = ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'];

export async function detectSource(rawInput: string): Promise<DetectResult> {
  const input = rawInput.trim();

  // 1. Pattern-based (no network)
  const pattern = detectByPattern(input);
  if (pattern) return pattern;

  // Normalize to URL
  let urlObj: URL;
  try {
    urlObj = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    return fallback(input, 'low', 'Could not parse as URL');
  }
  const url = urlObj.href;

  // 2. Try URL itself as RSS
  if (await isRSSFeed(url)) {
    return { connector_type: 'rss', url_or_handle: url, source_mode: 'rss', config: {}, confidence: 'high', note: 'Direct RSS/Atom feed detected' };
  }

  // 3. Try common RSS paths on the same origin
  for (const path of RSS_PATHS) {
    const feedUrl = `${urlObj.origin}${path}`;
    if (await isRSSFeed(feedUrl)) {
      return { connector_type: 'rss', url_or_handle: feedUrl, source_mode: 'rss', config: {}, confidence: 'high', note: `RSS feed found at ${urlObj.origin}${path}` };
    }
  }

  // 4. Fetch page and analyze HTML structure
  return analyzeWebsite(url);
}

// ─── Pattern matching ─────────────────────────────────────────────────────────

function detectByPattern(input: string): DetectResult | null {
  // YouTube — channel ID
  const ytId = input.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (ytId) return hi('youtube', ytId[1], 'official_api', {}, 'YouTube channel ID');

  // YouTube — @handle
  const ytHandle = input.match(/youtube\.com\/@([\w.-]+)/i);
  if (ytHandle) return hi('youtube', `@${ytHandle[1]}`, 'official_api', {}, 'YouTube @handle');

  // YouTube — /c/name (legacy)
  const ytLegacy = input.match(/youtube\.com\/c\/([\w.-]+)/i);
  if (ytLegacy) return hi('youtube', ytLegacy[1], 'official_api', {}, 'YouTube channel URL (legacy)');

  // X / Twitter
  const xMatch = input.match(/(?:x\.com|twitter\.com)\/@?([\w]+)/i);
  if (xMatch) return hi('x_browser', `@${xMatch[1]}`, 'website_parse', {}, 'X/Twitter profile — CF Browser Rendering');

  // Telegram
  const tgMatch = input.match(/(?:t\.me|telegram\.me)\/@?([\w]+)/i);
  if (tgMatch) return hi('telegram', `@${tgMatch[1]}`, 'website_parse', {}, 'Telegram channel — CF Browser Rendering');

  // Facebook
  if (/facebook\.com\//.test(input)) {
    const slug = input.match(/facebook\.com\/([^/?#\s]+)/i)?.[1];
    const handle = slug ? `https://facebook.com/${slug}` : input;
    return hi('facebook_browser', handle, 'website_parse', {}, 'Facebook — CF Browser Rendering');
  }

  // Instagram
  const igMatch = input.match(/instagram\.com\/@?([\w.]+)/i);
  if (igMatch) return hi('instagram_pro', igMatch[1], 'provider_api', {}, 'Instagram — requires IG_ACCESS_TOKEN');

  // TikTok
  const ttMatch = input.match(/tiktok\.com\/@?([^/?#\s]+)/i);
  if (ttMatch) return hi('tiktok', `@${ttMatch[1].replace(/^@/, '')}`, 'website_parse', {}, 'TikTok — HTTP SSR fetch + CF Browser fallback');
  if (/tiktok\.com/i.test(input)) return hi('tiktok', input, 'website_parse', {}, 'TikTok — HTTP SSR fetch + CF Browser fallback');

  // Threads — watch-only
  if (/threads\.net\//i.test(input)) {
    return { connector_type: 'threads_watch', url_or_handle: input, source_mode: 'manual_watch', config: {}, confidence: 'high', note: 'Threads — watch-only, no automated fetch' };
  }

  // URL looks like a feed already
  if (/\.(rss|atom)$/i.test(input) || /\/(rss|feed|atom)(\/|$|\?)/i.test(input)) {
    return { connector_type: 'rss', url_or_handle: input, source_mode: 'rss', config: {}, confidence: 'medium', note: 'URL pattern suggests RSS feed — verify it loads correctly' };
  }

  return null;
}

// ─── RSS probe ────────────────────────────────────────────────────────────────

async function isRSSFeed(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SociaResearch/0.1 feed-detector' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') ?? '';
    if (RSS_CONTENT_TYPES.some(t => ct.includes(t))) return true;
    const text = await res.text();
    return /<rss[\s>]|<feed[\s>]|<channel>/.test(text.slice(0, 2000));
  } catch {
    return false;
  }
}

// ─── Website analysis ─────────────────────────────────────────────────────────

async function analyzeWebsite(url: string): Promise<DetectResult> {
  let html = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SociaResearch/0.1 (research bot)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return fallback(url, 'low', `Site returned HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    return fallback(url, 'low', `Could not fetch: ${String(err).slice(0, 80)}`);
  }

  // SPA / client-side rendered signals
  const isSPA =
    html.includes('__NEXT_DATA__') ||
    html.includes('__nuxt') ||
    html.includes('ng-app') ||
    html.includes('data-reactroot') ||
    html.includes('data-react-helmet') ||
    (html.split('<script').length > 15 && !/<article[\s>]/i.test(html));

  if (isSPA) {
    return {
      connector_type: 'website',
      url_or_handle: url,
      source_mode: 'website_parse',
      config: {},
      confidence: 'low',
      note: 'Site uses client-side rendering (SPA) — HTMLRewriter will not extract content. Look for an RSS feed instead.',
    };
  }

  const articleCount = (html.match(/<article[\s>]/gi) ?? []).length;
  const hasH2Links = /<h[23][^>]*>[\s\S]{0,200}<a\s/i.test(html);

  if (articleCount > 0 || hasH2Links) {
    const itemSel = articleCount > 0 ? 'article' : 'li';
    return {
      connector_type: 'website',
      url_or_handle: url,
      source_mode: 'website_parse',
      config: { item_selector: itemSel, title_selector: 'h2|h3', link_selector: 'a', text_selector: 'p' },
      confidence: 'medium',
      note: `Server-rendered HTML detected (${articleCount} <article> elements). Verify selectors in config.`,
    };
  }

  return {
    connector_type: 'website',
    url_or_handle: url,
    source_mode: 'website_parse',
    config: { item_selector: 'article', title_selector: 'h2', link_selector: 'a', text_selector: 'p' },
    confidence: 'low',
    note: 'No clear article structure found. Inspect the page and set custom selectors manually.',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hi(ct: string, handle: string, mode: string, config: Record<string, unknown>, note: string): DetectResult {
  return { connector_type: ct, url_or_handle: handle, source_mode: mode, config, confidence: 'high', note };
}

function fallback(url: string, confidence: DetectResult['confidence'], note: string): DetectResult {
  return { connector_type: 'website', url_or_handle: url, source_mode: 'website_parse', config: {}, confidence, note };
}
