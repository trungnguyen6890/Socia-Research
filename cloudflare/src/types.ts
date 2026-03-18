// ─── Cloudflare Worker Env bindings ──────────────────────────────────────────

export interface Env {
  DB: D1Database;
  RATE_KV: KVNamespace;
  BROWSER: Fetcher;
  ADMIN_PASSWORD: string;
  YOUTUBE_API_KEY?: string;
  X_BEARER_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  FB_ACCESS_TOKEN?: string;
  FB_COOKIES?: string;
  IG_ACCESS_TOKEN?: string;
}

// ─── Connector types ──────────────────────────────────────────────────────────

export type ConnectorType =
  | 'rss'
  | 'website'
  | 'youtube'
  | 'x_browser'
  | 'telegram'
  | 'facebook_page'
  | 'facebook_browser'
  | 'instagram_pro'
  | 'facebook_profile_watch'
  | 'tiktok_watch'
  | 'threads_watch';

export type SourceMode =
  | 'official_api'
  | 'rss'
  | 'website_parse'
  | 'manual_watch'
  | 'provider_api';

export type MatchMode = 'exact' | 'contains' | 'regex';

export const WATCH_ONLY: Set<ConnectorType> = new Set([
  'facebook_profile_watch',
  'tiktok_watch',
  'threads_watch',
]);

// ─── DB row shapes ────────────────────────────────────────────────────────────

export interface SourceRow {
  id: string;
  name: string;
  connector_type: ConnectorType;
  source_mode: SourceMode;
  url_or_handle: string;
  config: string;       // JSON
  tags: string;         // JSON
  priority: number;
  is_active: number;    // 0 | 1
  last_fetched_at: string | null;
  last_cursor: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeywordRow {
  id: string;
  keyword: string;
  category: string;
  match_mode: MatchMode;
  is_active: number;
  created_at: string;
}

export interface GoalRow {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  is_active: number;
  created_at: string;
  keywords?: KeywordRow[];
}

export interface ScheduleRow {
  id: string;
  source_id: string;
  cron_expression: string;
  is_active: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  source_name?: string;
  connector_type?: string;
}

export interface ContentItemRow {
  id: string;
  source_id: string;
  connector_type: string;
  url: string;
  canonical_url: string | null;
  title: string | null;
  text_content: string | null;
  publish_time: string | null;
  fetch_time: string;
  engagement_snapshot: string | null;  // JSON
  tags: string;                         // JSON
  content_hash: string | null;
  is_duplicate: number;
  duplicate_of_id: string | null;
  quality_score: number;
  signal_score: number;
  raw_data: string | null;             // JSON
  // Enrichment fields
  content_type: string | null;
  language: string | null;
  author_name: string | null;
  has_media: number;
  is_truncated: number;
  // Joined from sources
  source_name?: string;
  source_mode?: string;
}

export interface RunLogRow {
  id: string;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  items_fetched: number;
  error_message: string | null;
  source_name?: string;
}

// ─── Pipeline types ───────────────────────────────────────────────────────────

export interface FetchResult {
  rawItems: RawItem[];
  newCursor: string | null;
}

export interface RawItem {
  url: string;
  title?: string | null;
  textContent?: string | null;
  publishTime?: string | null;
  engagementSnapshot?: Record<string, number | string> | null;
  rawData?: Record<string, unknown>;
  // Enrichment hints from connectors (normalize.ts uses these or auto-derives)
  contentType?: string | null;
  authorName?: string | null;
  hasMedia?: boolean;
}

export interface NormalizedItem {
  id: string;
  source_id: string;
  connector_type: string;
  url: string;
  canonical_url: string | null;
  title: string | null;
  text_content: string | null;
  publish_time: string | null;
  engagement_snapshot: string | null;
  tags: string;
  content_hash: string | null;
  is_duplicate: boolean;
  duplicate_of_id: string | null;
  quality_score: number;
  signal_score: number;
  raw_data: string | null;
  // Enrichment fields
  content_type: string | null;
  language: string | null;
  author_name: string | null;
  has_media: boolean;
  is_truncated: boolean;
}
