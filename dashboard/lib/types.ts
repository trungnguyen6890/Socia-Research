export interface Source {
  id: string;
  name: string;
  connector_type: string;
  source_mode: string;
  url_or_handle: string;
  config: string;
  tags: string;
  priority: number;
  is_active: number;
  last_fetched_at: string | null;
  last_cursor: string | null;
  created_at: string;
  updated_at: string;
}

export interface Keyword {
  id: string;
  keyword: string;
  category: string;
  match_mode: string;
  is_active: number;
  created_at: string;
}

export interface Goal {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  is_active: number;
  created_at: string;
  keywords?: Keyword[];
}

export interface ContentItem {
  id: string;
  source_id: string;
  connector_type: string;
  url: string;
  canonical_url: string | null;
  title: string | null;
  text_content: string | null;
  publish_time: string | null;
  fetch_time: string;
  engagement_snapshot: string | null;
  tags: string;
  content_hash: string | null;
  is_duplicate: number;
  duplicate_of_id: string | null;
  quality_score: number;
  signal_score: number;
  raw_data: string | null;
  source_name?: string;
}

export interface RunLog {
  id: string;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  items_fetched: number;
  error_message: string | null;
  source_name?: string;
}

export interface Schedule {
  id: string;
  source_id: string;
  cron_expression: string;
  is_active: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  source_name?: string;
}

export interface Settings {
  cron_interval_minutes: string;
  cron_enabled: string;
  last_cron_run_at?: string;
}

export interface DashboardStats {
  totalItems: number;
  items24h: number;
  activeSources: number;
  totalSources: number;
}
