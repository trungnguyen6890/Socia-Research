import { Env } from './types';

export type D1Row = Record<string, unknown>;

// ─── Generic helpers ─────────────────────────────────────────────────────────

export async function dbAll<T extends D1Row>(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const stmt = env.DB.prepare(sql);
  const result = await (params.length ? stmt.bind(...params) : stmt).all<T>();
  return result.results;
}

export async function dbFirst<T extends D1Row>(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  const stmt = env.DB.prepare(sql);
  return (params.length ? stmt.bind(...params) : stmt).first<T>();
}

export async function dbRun(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<D1Result> {
  const stmt = env.DB.prepare(sql);
  return (params.length ? stmt.bind(...params) : stmt).run();
}

export async function dbBatch(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  await env.DB.batch(statements);
}

// ─── Typed query helpers ──────────────────────────────────────────────────────

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

// ─── Source queries ───────────────────────────────────────────────────────────

export async function getSources(env: Env, activeOnly = false) {
  const sql = activeOnly
    ? 'SELECT * FROM sources WHERE is_active = 1 ORDER BY priority, created_at'
    : 'SELECT * FROM sources ORDER BY created_at DESC';
  return dbAll(env, sql);
}

export async function getSource(env: Env, id: string) {
  return dbFirst(env, 'SELECT * FROM sources WHERE id = ?', id);
}

export async function upsertSource(env: Env, source: Record<string, unknown>) {
  return dbRun(env,
    `INSERT INTO sources (id, name, connector_type, source_mode, url_or_handle, config, tags, priority, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       connector_type = excluded.connector_type,
       source_mode = excluded.source_mode,
       url_or_handle = excluded.url_or_handle,
       config = excluded.config,
       tags = excluded.tags,
       priority = excluded.priority,
       is_active = excluded.is_active,
       updated_at = datetime('now')`,
    source.id, source.name, source.connector_type, source.source_mode,
    source.url_or_handle, source.config, source.tags, source.priority, source.is_active,
  );
}

export async function updateSourceCursor(env: Env, id: string, cursor: string | null) {
  return dbRun(env,
    `UPDATE sources SET last_cursor = ?, last_fetched_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    cursor, id,
  );
}

// ─── Keyword queries ──────────────────────────────────────────────────────────

export async function getKeywords(env: Env, activeOnly = false) {
  const sql = activeOnly
    ? 'SELECT * FROM keywords WHERE is_active = 1 ORDER BY category, keyword'
    : 'SELECT * FROM keywords ORDER BY category, keyword';
  return dbAll(env, sql);
}

// ─── Goal queries ─────────────────────────────────────────────────────────────

export async function getGoals(env: Env, activeOnly = false) {
  const sql = activeOnly
    ? 'SELECT * FROM goals WHERE is_active = 1 ORDER BY priority, name'
    : 'SELECT * FROM goals ORDER BY priority, name';
  const goals = await dbAll(env, sql);

  // Load keywords for each goal
  for (const goal of goals) {
    const kws = await dbAll(env,
      `SELECT k.* FROM keywords k
       JOIN goal_keywords gk ON gk.keyword_id = k.id
       WHERE gk.goal_id = ?`, goal.id);
    (goal as Record<string, unknown>).keywords = kws;
  }
  return goals;
}

// ─── Schedule queries ─────────────────────────────────────────────────────────

export async function getSchedules(env: Env) {
  return dbAll(env,
    `SELECT s.*, src.name as source_name, src.connector_type
     FROM schedules s
     LEFT JOIN sources src ON src.id = s.source_id
     ORDER BY s.created_at DESC`);
}

// ─── Content queries ──────────────────────────────────────────────────────────

export async function insertContentItem(env: Env, item: Record<string, unknown>) {
  return dbRun(env,
    `INSERT OR IGNORE INTO content_items
     (id, source_id, connector_type, url, canonical_url, title, text_content,
      publish_time, fetch_time, engagement_snapshot, tags, content_hash,
      is_duplicate, duplicate_of_id, quality_score, signal_score, raw_data,
      content_type, language, author_name, author_verified, has_media, is_truncated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id, item.source_id, item.connector_type, item.url, item.canonical_url,
    item.title, item.text_content, item.publish_time, item.engagement_snapshot,
    item.tags, item.content_hash, item.is_duplicate ? 1 : 0, item.duplicate_of_id,
    item.quality_score, item.signal_score, item.raw_data,
    item.content_type ?? null, item.language ?? null, item.author_name ?? null,
    item.author_verified ? 1 : 0, item.has_media ? 1 : 0, item.is_truncated ? 1 : 0,
  );
}

export async function findDuplicates(env: Env, urls: string[], hashes: string[]) {
  const urlPlaceholders = urls.map(() => '?').join(',');
  const hashPlaceholders = hashes.map(() => '?').join(',');

  const byUrl = urls.length
    ? await dbAll<{ id: string; url: string; canonical_url: string | null }>(env,
        `SELECT id, url, canonical_url FROM content_items WHERE url IN (${urlPlaceholders}) OR canonical_url IN (${urlPlaceholders})`,
        ...urls, ...urls)
    : [];
  const byHash = hashes.length
    ? await dbAll<{ id: string; content_hash: string }>(env,
        `SELECT id, content_hash FROM content_items WHERE content_hash IN (${hashPlaceholders})`,
        ...hashes)
    : [];
  return { byUrl, byHash };
}

export async function getContentItems(env: Env, opts: {
  page?: number;
  pageSize?: number;
  sourceId?: string;
  search?: string;
  minScore?: number;
  hideDuplicates?: boolean;
}) {
  const { page = 1, pageSize = 50, sourceId, search, minScore, hideDuplicates } = opts;
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (sourceId) { conditions.push('source_id = ?'); params.push(sourceId); }
  if (hideDuplicates) { conditions.push('is_duplicate = 0'); }
  if (minScore != null) { conditions.push('quality_score >= ?'); params.push(minScore); }
  if (search) {
    conditions.push('(title LIKE ? OR text_content LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [items, countRow] = await Promise.all([
    dbAll(env,
      `SELECT c.*, s.name as source_name, s.source_mode FROM content_items c LEFT JOIN sources s ON s.id = c.source_id ${where.replace(/\b(source_id|title|text_content|quality_score|is_duplicate)\b/g, 'c.$1')} ORDER BY c.fetch_time DESC LIMIT ? OFFSET ?`,
      ...params, pageSize, offset),
    dbFirst<{ total: number }>(env,
      `SELECT COUNT(*) as total FROM content_items c ${where.replace(/\b(source_id|title|text_content|quality_score|is_duplicate)\b/g, 'c.$1')}`, ...params),
  ]);
  return { items, total: countRow?.total ?? 0 };
}

// ─── RunLog queries ───────────────────────────────────────────────────────────

export async function createRunLog(env: Env, id: string, sourceId: string) {
  return dbRun(env,
    `INSERT INTO run_logs (id, source_id, status) VALUES (?, ?, 'running')`,
    id, sourceId);
}

export async function finishRunLog(env: Env, id: string, status: string, itemsFetched: number, error?: string) {
  return dbRun(env,
    `UPDATE run_logs SET status = ?, items_fetched = ?, finished_at = datetime('now'), error_message = ? WHERE id = ?`,
    status, itemsFetched, error ?? null, id);
}

export async function getRecentRuns(env: Env, limit = 20) {
  return dbAll(env,
    `SELECT r.*, s.name as source_name FROM run_logs r
     LEFT JOIN sources s ON s.id = r.source_id
     ORDER BY r.started_at DESC LIMIT ?`, limit);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSetting(env: Env, key: string, fallback: string): Promise<string> {
  const row = await dbFirst<{ value: string }>(env, 'SELECT value FROM settings WHERE key=?', key);
  return row?.value ?? fallback;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await dbRun(env,
    `INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    key, value);
}

export async function getAllSettings(env: Env): Promise<Record<string, string>> {
  const rows = await dbAll<{ key: string; value: string }>(env, 'SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
