-- D1 initial schema for Socia Research Bot

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connector_type TEXT NOT NULL,
  source_mode TEXT NOT NULL,
  url_or_handle TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',  -- JSON string
  tags TEXT NOT NULL DEFAULT '[]',    -- JSON string
  priority INTEGER NOT NULL DEFAULT 5,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT,
  last_cursor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  match_mode TEXT NOT NULL DEFAULT 'contains',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goal_keywords (
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  PRIMARY KEY (goal_id, keyword_id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE REFERENCES sources(id) ON DELETE CASCADE,
  cron_expression TEXT NOT NULL DEFAULT '*/30 * * * *',
  is_active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  connector_type TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT,
  text_content TEXT,
  publish_time TEXT,
  fetch_time TEXT NOT NULL DEFAULT (datetime('now')),
  engagement_snapshot TEXT,  -- JSON string
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON string
  content_hash TEXT,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  duplicate_of_id TEXT REFERENCES content_items(id),
  quality_score REAL NOT NULL DEFAULT 0.0,
  signal_score REAL NOT NULL DEFAULT 0.0,
  raw_data TEXT  -- JSON string
);

CREATE TABLE IF NOT EXISTS run_logs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  items_fetched INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_source ON content_items(source_id);
CREATE INDEX IF NOT EXISTS idx_content_url ON content_items(url);
CREATE INDEX IF NOT EXISTS idx_content_hash ON content_items(content_hash);
CREATE INDEX IF NOT EXISTS idx_content_fetch_time ON content_items(fetch_time DESC);
CREATE INDEX IF NOT EXISTS idx_run_logs_source ON run_logs(source_id);
CREATE INDEX IF NOT EXISTS idx_run_logs_started ON run_logs(started_at DESC);
