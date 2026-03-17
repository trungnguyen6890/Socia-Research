import { RawItem, NormalizedItem, SourceRow } from '../types';
import { jsonStringify } from '../db';

function generateId(): string {
  return crypto.randomUUID();
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
    // Remove trailing slash from path (except root)
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

export async function normalizeItem(raw: RawItem, source: SourceRow): Promise<NormalizedItem> {
  const url = raw.url ?? '';
  const text = raw.textContent ?? '';
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
  };
}
