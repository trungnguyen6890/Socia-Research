import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from '../types';
import {
  getSources, getSource, upsertSource, getKeywords, getGoals, getSchedules,
  getContentItems, getRecentRuns, getAllSettings, setSetting,
  dbFirst, dbRun, jsonParse,
} from '../db';
import { runSourcePipeline } from '../pipeline/runner';

// ─── Content item schema helpers ─────────────────────────────────────────────

const PLATFORM_MAP: Record<string, string> = {
  x_browser: 'twitter',
  youtube: 'youtube',
  facebook_page: 'facebook', facebook_browser: 'facebook', facebook_profile_watch: 'facebook',
  instagram_pro: 'instagram',
  telegram: 'telegram',
  tiktok_watch: 'tiktok',
  threads_watch: 'threads',
  rss: 'rss',
  website: 'website',
};

function toPlatform(connectorType: string): string {
  return PLATFORM_MAP[connectorType] ?? connectorType;
}

function formatContentItem(row: Record<string, unknown>) {
  const connectorType = row.connector_type as string;
  const engagement = jsonParse<Record<string, number>>(row.engagement_snapshot as string | null, {});
  return {
    id: row.id,
    platform: toPlatform(connectorType),
    source: row.source_name ?? null,
    source_type: connectorType,
    url: row.url,
    title: row.title ?? null,
    content_text: row.text_content ?? null,
    published_at: row.publish_time ?? null,
    engagement: {
      likes: Number(engagement.likes ?? 0),
      comments: Number(engagement.comments ?? engagement.replies ?? 0),
      shares: Number(engagement.shares ?? engagement.retweets ?? engagement.forwards ?? 0),
      views: Number(engagement.views ?? 0),
      reactions: Number(engagement.reactions ?? 0),
    },
    content_type: row.content_type ?? null,
    language: row.language ?? null,
    author_name: row.author_name ?? null,
    has_media: Boolean(row.has_media),
    duplicate_key: row.is_duplicate ? (row.duplicate_of_id ?? row.content_hash ?? null) : null,
    is_truncated: Boolean(row.is_truncated),
    tags: jsonParse<string[]>(row.tags as string | null, []),
    quality_score: Number(row.quality_score ?? 0),
    signal_score: Number(row.signal_score ?? 0),
    fetch_time: row.fetch_time ?? null,
  };
}

export function createApiRouter() {
  const api = new Hono<{ Bindings: Env }>();

  // CORS for dashboard
  api.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));

  // Auth — check password via Authorization header or cookie
  api.use('*', async (c, next) => {
    const auth = c.req.header('Authorization')?.replace('Bearer ', '');
    const cookie = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
    const token = auth || cookie;
    if (token !== c.env.ADMIN_PASSWORD) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  });

  // ─── Dashboard stats ──────────────────────────────────────────────────────
  api.get('/api/stats', async (c) => {
    const [totalRow, todayRow, activeRow, totalSrcRow] = await Promise.all([
      dbFirst<{ n: number }>(c.env, 'SELECT COUNT(*) as n FROM content_items'),
      dbFirst<{ n: number }>(c.env, "SELECT COUNT(*) as n FROM content_items WHERE fetch_time >= datetime('now','-1 day')"),
      dbFirst<{ n: number }>(c.env, 'SELECT COUNT(*) as n FROM sources WHERE is_active=1'),
      dbFirst<{ n: number }>(c.env, 'SELECT COUNT(*) as n FROM sources'),
    ]);
    return c.json({
      totalItems: totalRow?.n ?? 0,
      items24h: todayRow?.n ?? 0,
      activeSources: activeRow?.n ?? 0,
      totalSources: totalSrcRow?.n ?? 0,
    });
  });

  // ─── Sources ──────────────────────────────────────────────────────────────
  api.get('/api/sources', async (c) => {
    const sources = await getSources(c.env);
    return c.json(sources);
  });

  api.post('/api/sources', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.name || !body.connector_type) return c.json({ error: 'name and connector_type required' }, 400);
    const id = crypto.randomUUID();
    await upsertSource(c.env, {
      id,
      name: body.name,
      connector_type: body.connector_type,
      source_mode: body.source_mode ?? 'rss',
      url_or_handle: body.url_or_handle ?? '',
      config: body.config ?? '{}',
      tags: body.tags ?? '[]',
      priority: body.priority ?? 5,
      is_active: body.is_active ?? 1,
    });
    const created = await getSource(c.env, id);
    return c.json(created, 201);
  });

  api.put('/api/sources/:id', async (c) => {
    const id = c.req.param('id');
    const existing = await getSource(c.env, id) as Record<string, unknown> | null;
    if (!existing) return c.json({ error: 'Source not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    await upsertSource(c.env, {
      id,
      name: body.name ?? existing.name,
      connector_type: body.connector_type ?? existing.connector_type,
      source_mode: body.source_mode ?? existing.source_mode,
      url_or_handle: body.url_or_handle ?? existing.url_or_handle,
      config: body.config ?? existing.config,
      tags: body.tags ?? existing.tags,
      priority: body.priority ?? existing.priority,
      is_active: body.is_active ?? existing.is_active,
    });
    const updated = await getSource(c.env, id);
    return c.json(updated);
  });

  api.post('/api/sources/:id/toggle', async (c) => {
    const id = c.req.param('id');
    const src = await getSource(c.env, id) as Record<string, unknown> | null;
    if (!src) return c.json({ error: 'Source not found' }, 404);
    const newActive = src.is_active ? 0 : 1;
    await dbRun(c.env, "UPDATE sources SET is_active=?, updated_at=datetime('now') WHERE id=?", newActive, id);
    return c.json({ id, is_active: newActive });
  });

  api.delete('/api/sources/:id', async (c) => {
    const id = c.req.param('id');
    await dbRun(c.env, 'DELETE FROM run_logs WHERE source_id=?', id);
    await dbRun(c.env, 'DELETE FROM content_items WHERE source_id=?', id);
    await dbRun(c.env, 'DELETE FROM schedules WHERE source_id=?', id);
    await dbRun(c.env, 'DELETE FROM sources WHERE id=?', id);
    return c.json({ ok: true });
  });

  api.post('/api/sources/:id/run', async (c) => {
    const source = await getSource(c.env, c.req.param('id'));
    if (!source) return c.json({ error: 'Source not found' }, 404);
    const result = await runSourcePipeline(source as never, c.env);
    return c.json(result);
  });

  // ─── Content ──────────────────────────────────────────────────────────────
  api.get('/api/content', async (c) => {
    const url = new URL(c.req.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const sourceId = url.searchParams.get('source_id') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const minScore = url.searchParams.get('min_score') ? Number(url.searchParams.get('min_score')) : undefined;
    const hideDups = url.searchParams.get('hide_duplicates') === '1';

    const result = await getContentItems(c.env, {
      page, pageSize: 50, sourceId, search, minScore, hideDuplicates: hideDups,
    });
    return c.json({
      items: result.items.map((row) => formatContentItem(row as Record<string, unknown>)),
      total: result.total,
    });
  });

  // ─── Keywords ─────────────────────────────────────────────────────────────
  api.get('/api/keywords', async (c) => {
    const keywords = await getKeywords(c.env);
    return c.json(keywords);
  });

  // ─── Goals ────────────────────────────────────────────────────────────────
  api.get('/api/goals', async (c) => {
    const goals = await getGoals(c.env);
    return c.json(goals);
  });

  // ─── Schedules ────────────────────────────────────────────────────────────
  api.get('/api/schedules', async (c) => {
    const schedules = await getSchedules(c.env);
    return c.json(schedules);
  });

  // ─── Runs ─────────────────────────────────────────────────────────────────
  api.get('/api/runs', async (c) => {
    const limit = Number(new URL(c.req.url).searchParams.get('limit') ?? 20);
    const runs = await getRecentRuns(c.env, limit);
    return c.json(runs);
  });

  // ─── Settings ─────────────────────────────────────────────────────────────
  api.get('/api/settings', async (c) => {
    const settings = await getAllSettings(c.env);
    return c.json(settings);
  });

  api.post('/api/settings', async (c) => {
    const body = await c.req.json<Record<string, string>>();
    for (const [key, value] of Object.entries(body)) {
      await setSetting(c.env, key, value);
    }
    return c.json({ ok: true });
  });

  return api;
}
