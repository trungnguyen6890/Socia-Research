import { RawItem, NormalizedItem, SourceRow } from '../types';
import { jsonStringify } from '../db';

function generateId(): string {
  return crypto.randomUUID();
}

/** Strip HTML tags and decode common entities — used to clean RSS content */
function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const trackingParams = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
    ]);
    for (const key of [...u.searchParams.keys()]) {
      if (trackingParams.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return url;
  }
}

async function contentHash(text: string): Promise<string> {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function detectLanguage(text: string): string {
  if (!text || text.length < 10) return 'unknown';
  if (/[àáâãèéêìíòóôõùúăđơưạảấầẩẫậắặẵẻẽếềệỉịọỏốồổỗộớờởỡợụủứừửữựỳỷỹ]/i.test(text)) return 'vi';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';
  return 'en';
}

function contentTypeFromConnector(connectorType: string): string {
  if (connectorType === 'x_browser') return 'tweet';
  if (connectorType === 'youtube') return 'video';
  if (['instagram_pro', 'threads_watch'].includes(connectorType)) return 'post';
  if (connectorType === 'telegram') return 'message';
  return 'article';
}

function checkTruncated(text: string | null): boolean {
  if (!text) return false;
  return text.endsWith('…') || text.endsWith('...');
}

export async function normalizeItem(raw: RawItem, source: SourceRow): Promise<NormalizedItem> {
  const url = raw.url ?? '';
  const text = stripHtml(raw.textContent ?? '') ?? '';
  const hashInput = `${raw.title ?? ''} ${text}`.trim();

  return {
    id: generateId(),
    source_id: source.id,
    connector_type: source.connector_type,
    url,
    canonical_url: url ? canonicalizeUrl(url) : null,
    title: raw.title ?? null,
    text_content: text || null,
    publish_time: raw.publishTime ?? null,
    engagement_snapshot: raw.engagementSnapshot ? jsonStringify(raw.engagementSnapshot) : null,
    tags: '[]',
    content_hash: hashInput ? await contentHash(hashInput) : null,
    is_duplicate: false,
    duplicate_of_id: null,
    quality_score: 0,
    signal_score: 0,
    raw_data: raw.rawData ? jsonStringify(raw.rawData) : null,
    content_type: raw.contentType ?? contentTypeFromConnector(source.connector_type),
    language: detectLanguage(text),
    author_name: raw.authorName ?? null,
    has_media: raw.hasMedia ?? false,
    is_truncated: checkTruncated(text || null),
  };
}
