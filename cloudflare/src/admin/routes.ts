import { Hono } from 'hono';
import { Env } from '../types';
import { layout, badge, statusBadge, scoreBar, truncate, fmtDate, pagination } from './html';
import {
  getSources, getSource, upsertSource, dbRun, dbFirst,
  getKeywords, getGoals, getSchedules, getContentItems,
  getRecentRuns, dbAll, getAllSettings, setSetting,
} from '../db';
import { runSourcePipeline } from '../pipeline/runner';
import { jsonParse } from '../db';

const CONNECTOR_TYPES = [
  'rss', 'website', 'youtube', 'x_browser', 'telegram',
  'facebook_page', 'instagram_pro', 'facebook_profile_watch', 'tiktok_watch', 'threads_watch',
];
const SOURCE_MODES = ['official_api', 'rss', 'website_parse', 'manual_watch', 'provider_api'];
const MATCH_MODES = ['exact', 'contains', 'regex'];

export function createAdminRouter() {
  const app = new Hono<{ Bindings: Env }>();

  // ─── Auth middleware ────────────────────────────────────────────────────────
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === '/admin/login') return next();

    const session = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
    if (session !== c.env.ADMIN_PASSWORD) {
      if (c.req.method === 'POST' && path === '/admin/login') return next();
      return c.redirect('/admin/login');
    }
    return next();
  });

  // ─── Login ──────────────────────────────────────────────────────────────────
  app.get('/admin/login', (c) => {
    const body = `<h2>Login</h2>
<form method="post" action="/admin/login" style="max-width:320px">
<div class="form-group"><label>Password</label>
<input type="password" name="password" autofocus required></div>
<button type="submit" class="btn btn-primary" style="width:100%">Login</button>
</form>`;
    return c.html(layout('Login', '/admin/login', body));
  });

  app.post('/admin/login', async (c) => {
    const form = await c.req.formData();
    const pwd = form.get('password') as string;
    if (pwd === c.env.ADMIN_PASSWORD) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/admin/',
          'Set-Cookie': `session=${pwd}; Path=/admin; HttpOnly; SameSite=Strict`,
        },
      });
    }
    return c.redirect('/admin/login?error=1');
  });

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  app.get('/admin/', async (c) => {
    const [totalRow, todayRow, activeRow, totalSrcRow, runs] = await Promise.all([
      dbFirst<{ n: number }>(c.env, 'SELECT COUNT(*) as n FROM content_items'),
      dbFirst<{ n: number }>(c.env, "SELECT COUNT(*) as n FROM content_items WHERE fetch_time >= datetime('now','-1 day')"),
      dbFirst<{ n: number }>(c.env, 'SELECT COUNT(*) as n FROM sources WHERE is_active=1'),
      dbFirst<{ n: number }>(c.env, 'SELECT COUNT(*) as n FROM sources'),
      getRecentRuns(c.env, 15),
    ]);

    const statsHtml = `
<div class="stats">
  <div class="stat-card"><div class="label">Total Items</div><div class="value">${totalRow?.n ?? 0}</div></div>
  <div class="stat-card"><div class="label">Items (24h)</div><div class="value">${todayRow?.n ?? 0}</div></div>
  <div class="stat-card"><div class="label">Active Sources</div><div class="value">${activeRow?.n ?? 0} / ${totalSrcRow?.n ?? 0}</div></div>
</div>`;

    const rows = (runs as Record<string, unknown>[]).map((r) => `<tr>
<td>${r.source_name ?? String(r.source_id).slice(0,8)}</td>
<td>${statusBadge(r.status as string)}</td>
<td>${r.items_fetched}</td>
<td>${fmtDate(r.started_at as string)}</td>
<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.error_message ?? '—'}</td>
</tr>`).join('');

    const body = `${statsHtml}
<h3 style="margin-bottom:1rem">Recent Runs</h3>
<table><thead><tr><th>Source</th><th>Status</th><th>Items</th><th>Started</th><th>Error</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No runs yet</td></tr>'}</tbody></table>`;

    return c.html(layout('Dashboard', '/', body));
  });

  // ─── Sources ────────────────────────────────────────────────────────────────
  app.get('/admin/sources', async (c) => {
    const sources = await getSources(c.env);
    const rows = (sources as Record<string, unknown>[]).map((s) => `<tr id="src-row-${s.id}">
<td><strong>${s.name}</strong><br><span style="font-size:.72rem;color:var(--muted)">${s.url_or_handle}</span></td>
<td><span class="badge b-blue">${s.connector_type}</span></td>
<td><span class="badge b-muted">${s.source_mode}</span></td>
<td>${s.priority}</td>
<td>${badge('', Number(s.is_active))}</td>
<td>${fmtDate(s.last_fetched_at as string)}</td>
<td class="actions">
  <a href="/admin/content?source_id=${s.id}" class="btn btn-sm btn-outline" title="View collected content">📄 Content</a>
  <a href="/admin/sources/${s.id}/edit" class="btn btn-sm btn-outline">Edit</a>
  <button class="btn btn-sm btn-primary" id="run-btn-${s.id}" onclick="runSource('${s.id}')">▶ Run</button>
  <form method="post" action="/admin/sources/${s.id}/toggle" style="display:inline">
    <button class="btn btn-sm btn-outline" type="submit">${s.is_active ? 'Disable' : 'Enable'}</button>
  </form>
  <form method="post" action="/admin/sources/${s.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')">
    <button class="btn btn-sm btn-danger" type="submit">Del</button>
  </form>
</td></tr>`).join('');

    const script = `<script>
async function runSource(id) {
  const btn = document.getElementById('run-btn-' + id);
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.className = 'btn btn-sm btn-outline';
  btn.innerHTML = '<span class="spin">⏳</span> Running…';

  try {
    const res = await fetch('/admin/sources/' + id + '/run', { method: 'POST' });
    const d = await res.json();

    if (d.status === 'error') {
      btn.className = 'btn btn-sm btn-danger';
      btn.innerHTML = '⚠ Error';
      btn.title = d.error || 'Unknown error';
      showToast('error', '⚠ ' + (d.error || 'Run failed'));
    } else if (d.status === 'skipped') {
      btn.className = 'btn btn-sm btn-outline';
      btn.innerHTML = '— Skipped';
      btn.title = d.reason || '';
      showToast('info', 'Skipped: ' + (d.reason || ''));
    } else {
      const n = d.itemsFetched ?? 0;
      const dup = d.duplicates ?? 0;
      const filtered = d.filtered ?? 0;
      btn.className = 'btn btn-sm btn-success';
      btn.innerHTML = '✓ +' + n + ' new';
      btn.title = n + ' new, ' + dup + ' duplicates skipped, ' + filtered + ' filtered';
      showToast('success', '✓ Fetched ' + n + ' new items' + (dup ? ', ' + dup + ' duplicates skipped' : '') + (filtered ? ', ' + filtered + ' filtered' : ''));
    }
  } catch(e) {
    btn.className = 'btn btn-sm btn-danger';
    btn.innerHTML = '⚠ Failed';
    showToast('error', '⚠ Network error: ' + e.message);
  }

  setTimeout(() => {
    btn.disabled = false;
    btn.className = 'btn btn-sm btn-primary';
    btn.innerHTML = orig;
    btn.title = '';
  }, 6000);
}

function showToast(type, msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 4000);
}
</script>`;

    const body = `<div class="toolbar"><h2>Sources</h2><a href="/admin/sources/new" class="btn btn-primary">+ Add Source</a></div>
<table><thead><tr><th>Name / URL</th><th>Type</th><th>Mode</th><th>Priority</th><th>Status</th><th>Last Fetch</th><th>Actions</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--muted)">No sources yet</td></tr>'}</tbody></table>
${script}`;
    return c.html(layout('Sources', '/admin/sources', body));
  });

  app.get('/admin/sources/new', (c) => {
    return c.html(layout('New Source', '/admin/sources', sourceForm(null)));
  });

  app.get('/admin/sources/:id/edit', async (c) => {
    const source = await getSource(c.env, c.req.param('id'));
    return c.html(layout('Edit Source', '/admin/sources', sourceForm(source as Record<string, unknown> | null)));
  });

  app.post('/admin/sources/new', async (c) => {
    const f = await c.req.formData();
    const id = crypto.randomUUID();
    let config = '{}';
    try { JSON.parse(f.get('config_json') as string); config = f.get('config_json') as string; } catch {}
    const tags = (f.get('tags_str') as string).split(',').map(s=>s.trim()).filter(Boolean);
    await upsertSource(c.env, {
      id, name: f.get('name'), connector_type: f.get('connector_type'),
      source_mode: f.get('source_mode'), url_or_handle: f.get('url_or_handle') ?? '',
      config, tags: JSON.stringify(tags), priority: Number(f.get('priority') ?? 5),
      is_active: 1,
    });
    return c.redirect('/admin/sources');
  });

  app.post('/admin/sources/:id/edit', async (c) => {
    const f = await c.req.formData();
    const existing = await getSource(c.env, c.req.param('id'));
    if (!existing) return c.redirect('/admin/sources');
    let config = (existing as Record<string,unknown>).config as string;
    try { JSON.parse(f.get('config_json') as string); config = f.get('config_json') as string; } catch {}
    const tags = (f.get('tags_str') as string ?? '').split(',').map(s=>s.trim()).filter(Boolean);
    await upsertSource(c.env, {
      id: c.req.param('id'), name: f.get('name'), connector_type: f.get('connector_type'),
      source_mode: f.get('source_mode'), url_or_handle: f.get('url_or_handle') ?? '',
      config, tags: JSON.stringify(tags), priority: Number(f.get('priority') ?? 5),
      is_active: f.get('is_active') === 'on' ? 1 : 0,
    });
    return c.redirect('/admin/sources');
  });

  app.post('/admin/sources/:id/toggle', async (c) => {
    const src = await getSource(c.env, c.req.param('id')) as Record<string,unknown> | null;
    if (src) await dbRun(c.env, 'UPDATE sources SET is_active=?,updated_at=datetime(\'now\') WHERE id=?',
      src.is_active ? 0 : 1, c.req.param('id'));
    return c.redirect('/admin/sources');
  });

  app.post('/admin/sources/:id/delete', async (c) => {
    const id = c.req.param('id');
    await dbRun(c.env, 'DELETE FROM run_logs WHERE source_id=?', id);
    await dbRun(c.env, 'DELETE FROM content_items WHERE source_id=?', id);
    await dbRun(c.env, 'DELETE FROM schedules WHERE source_id=?', id);
    await dbRun(c.env, 'DELETE FROM sources WHERE id=?', id);
    return c.redirect('/admin/sources');
  });

  app.post('/admin/sources/:id/run', async (c) => {
    const source = await getSource(c.env, c.req.param('id'));
    if (!source) return c.json({ error: 'Source not found' }, 404);
    const result = await runSourcePipeline(source as never, c.env);
    return c.json(result);
  });

  // ─── Keywords ───────────────────────────────────────────────────────────────
  app.get('/admin/keywords', async (c) => {
    const kws = await getKeywords(c.env);
    const rows = (kws as Record<string, unknown>[]).map((k) => `<tr>
<td><strong>${k.keyword}</strong></td>
<td><span class="badge b-blue">${k.category}</span></td>
<td>${k.match_mode}</td>
<td>${badge('', Number(k.is_active))}</td>
<td class="actions">
  <a href="/admin/keywords/${k.id}/edit" class="btn btn-sm btn-outline">Edit</a>
  <form method="post" action="/admin/keywords/${k.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')">
    <button class="btn btn-sm btn-danger" type="submit">Del</button>
  </form>
</td></tr>`).join('');

    const body = `<div class="toolbar"><h2>Keywords</h2><a href="/admin/keywords/new" class="btn btn-primary">+ Add Keyword</a></div>
<table><thead><tr><th>Keyword</th><th>Category</th><th>Match Mode</th><th>Status</th><th>Actions</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No keywords yet</td></tr>'}</tbody></table>`;
    return c.html(layout('Keywords', '/admin/keywords', body));
  });

  app.get('/admin/keywords/new', (c) =>
    c.html(layout('New Keyword', '/admin/keywords', keywordForm(null))));

  app.get('/admin/keywords/:id/edit', async (c) => {
    const kw = await dbFirst(c.env, 'SELECT * FROM keywords WHERE id=?', c.req.param('id'));
    return c.html(layout('Edit Keyword', '/admin/keywords', keywordForm(kw as Record<string,unknown> | null)));
  });

  app.post('/admin/keywords/new', async (c) => {
    const f = await c.req.formData();
    await dbRun(c.env, 'INSERT INTO keywords (id,keyword,category,match_mode) VALUES (?,?,?,?)',
      crypto.randomUUID(), f.get('keyword'), f.get('category') ?? 'general', f.get('match_mode') ?? 'contains');
    return c.redirect('/admin/keywords');
  });

  app.post('/admin/keywords/:id/edit', async (c) => {
    const f = await c.req.formData();
    await dbRun(c.env, 'UPDATE keywords SET keyword=?,category=?,match_mode=?,is_active=? WHERE id=?',
      f.get('keyword'), f.get('category') ?? 'general', f.get('match_mode') ?? 'contains',
      f.get('is_active') === 'on' ? 1 : 0, c.req.param('id'));
    return c.redirect('/admin/keywords');
  });

  app.post('/admin/keywords/:id/delete', async (c) => {
    await dbRun(c.env, 'DELETE FROM keywords WHERE id=?', c.req.param('id'));
    return c.redirect('/admin/keywords');
  });

  // ─── Goals ──────────────────────────────────────────────────────────────────
  app.get('/admin/goals', async (c) => {
    const goals = await getGoals(c.env);
    const rows = (goals as Record<string, unknown>[]).map((g) => {
      const kws = (g.keywords as Record<string,unknown>[] ?? []);
      const kwBadges = kws.map(k => `<span class="badge b-blue">${k.keyword}</span>`).join(' ');
      return `<tr>
<td><strong>${g.name}</strong></td>
<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.description ?? '—'}</td>
<td>${g.priority}</td>
<td>${kwBadges || '—'}</td>
<td>${badge('', Number(g.is_active))}</td>
<td class="actions">
  <a href="/admin/goals/${g.id}/edit" class="btn btn-sm btn-outline">Edit</a>
  <form method="post" action="/admin/goals/${g.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')">
    <button class="btn btn-sm btn-danger" type="submit">Del</button>
  </form>
</td></tr>`;
    }).join('');

    const body = `<div class="toolbar"><h2>Research Goals</h2><a href="/admin/goals/new" class="btn btn-primary">+ Add Goal</a></div>
<table><thead><tr><th>Name</th><th>Description</th><th>Priority</th><th>Keywords</th><th>Status</th><th>Actions</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">No goals yet</td></tr>'}</tbody></table>`;
    return c.html(layout('Goals', '/admin/goals', body));
  });

  app.get('/admin/goals/new', async (c) => {
    const allKws = await getKeywords(c.env, true);
    return c.html(layout('New Goal', '/admin/goals', goalForm(null, allKws as Record<string,unknown>[], [])));
  });

  app.get('/admin/goals/:id/edit', async (c) => {
    const goal = await dbFirst(c.env, 'SELECT * FROM goals WHERE id=?', c.req.param('id'));
    const allKws = await getKeywords(c.env, true);
    const selectedIds = (await dbAll(c.env, 'SELECT keyword_id FROM goal_keywords WHERE goal_id=?', c.req.param('id')))
      .map((r: Record<string,unknown>) => r.keyword_id as string);
    return c.html(layout('Edit Goal', '/admin/goals', goalForm(goal as Record<string,unknown> | null, allKws as Record<string,unknown>[], selectedIds)));
  });

  app.post('/admin/goals/new', async (c) => {
    const f = await c.req.formData();
    const id = crypto.randomUUID();
    await dbRun(c.env, 'INSERT INTO goals (id,name,description,priority) VALUES (?,?,?,?)',
      id, f.get('name'), f.get('description') ?? null, Number(f.get('priority') ?? 5));
    const kwIds = f.getAll('keyword_ids') as string[];
    for (const kid of kwIds) {
      await dbRun(c.env, 'INSERT OR IGNORE INTO goal_keywords (goal_id,keyword_id) VALUES (?,?)', id, kid);
    }
    return c.redirect('/admin/goals');
  });

  app.post('/admin/goals/:id/edit', async (c) => {
    const f = await c.req.formData();
    const id = c.req.param('id');
    await dbRun(c.env, 'UPDATE goals SET name=?,description=?,priority=?,is_active=? WHERE id=?',
      f.get('name'), f.get('description') ?? null, Number(f.get('priority') ?? 5),
      f.get('is_active') === 'on' ? 1 : 0, id);
    await dbRun(c.env, 'DELETE FROM goal_keywords WHERE goal_id=?', id);
    for (const kid of f.getAll('keyword_ids') as string[]) {
      await dbRun(c.env, 'INSERT OR IGNORE INTO goal_keywords (goal_id,keyword_id) VALUES (?,?)', id, kid);
    }
    return c.redirect('/admin/goals');
  });

  app.post('/admin/goals/:id/delete', async (c) => {
    await dbRun(c.env, 'DELETE FROM goals WHERE id=?', c.req.param('id'));
    return c.redirect('/admin/goals');
  });

  // ─── Schedules ──────────────────────────────────────────────────────────────
  app.get('/admin/schedules', async (c) => {
    const schedules = await getSchedules(c.env);
    const rows = (schedules as Record<string,unknown>[]).map((s) => `<tr>
<td><strong>${s.source_name ?? s.source_id}</strong></td>
<td><code>${s.cron_expression}</code></td>
<td>${badge('', Number(s.is_active))}</td>
<td>${fmtDate(s.last_run_at as string)}</td>
<td class="actions">
  <a href="/admin/schedules/${s.id}/edit" class="btn btn-sm btn-outline">Edit</a>
  <form method="post" action="/admin/schedules/${s.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')">
    <button class="btn btn-sm btn-danger" type="submit">Del</button>
  </form>
</td></tr>`).join('');

    const body = `<div class="toolbar"><h2>Schedules</h2><a href="/admin/schedules/new" class="btn btn-primary">+ Add Schedule</a></div>
<table><thead><tr><th>Source</th><th>Cron</th><th>Status</th><th>Last Run</th><th>Actions</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No schedules yet</td></tr>'}</tbody></table>`;
    return c.html(layout('Schedules', '/admin/schedules', body));
  });

  app.get('/admin/schedules/new', async (c) => {
    const sources = await getSources(c.env, true);
    return c.html(layout('New Schedule', '/admin/schedules', scheduleForm(null, sources as Record<string,unknown>[])));
  });

  app.get('/admin/schedules/:id/edit', async (c) => {
    const sched = await dbFirst(c.env, 'SELECT * FROM schedules WHERE id=?', c.req.param('id'));
    const sources = await getSources(c.env);
    return c.html(layout('Edit Schedule', '/admin/schedules', scheduleForm(sched as Record<string,unknown> | null, sources as Record<string,unknown>[])));
  });

  app.post('/admin/schedules/new', async (c) => {
    const f = await c.req.formData();
    await dbRun(c.env, 'INSERT INTO schedules (id,source_id,cron_expression) VALUES (?,?,?)',
      crypto.randomUUID(), f.get('source_id'), f.get('cron_expression') ?? '*/30 * * * *');
    return c.redirect('/admin/schedules');
  });

  app.post('/admin/schedules/:id/edit', async (c) => {
    const f = await c.req.formData();
    await dbRun(c.env, 'UPDATE schedules SET source_id=?,cron_expression=?,is_active=? WHERE id=?',
      f.get('source_id'), f.get('cron_expression') ?? '*/30 * * * *',
      f.get('is_active') === 'on' ? 1 : 0, c.req.param('id'));
    return c.redirect('/admin/schedules');
  });

  app.post('/admin/schedules/:id/delete', async (c) => {
    await dbRun(c.env, 'DELETE FROM schedules WHERE id=?', c.req.param('id'));
    return c.redirect('/admin/schedules');
  });

  // ─── Content ────────────────────────────────────────────────────────────────
  app.get('/admin/content', async (c) => {
    const url = new URL(c.req.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const sourceId = url.searchParams.get('source_id') ?? undefined;
    const search = url.searchParams.get('search') ?? undefined;
    const minScore = url.searchParams.get('min_score') ? Number(url.searchParams.get('min_score')) : undefined;
    const hideDups = url.searchParams.get('hide_duplicates') === '1';
    const PAGE_SIZE = 50;

    const [{ items, total }, sources] = await Promise.all([
      getContentItems(c.env, { page, pageSize: PAGE_SIZE, sourceId, search, minScore, hideDuplicates: hideDups }),
      getSources(c.env),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const buildUrl = (p: number) => {
      const u = new URL(c.req.url);
      u.searchParams.set('page', String(p));
      return u.pathname + u.search;
    };

    const srcOptions = (sources as Record<string,unknown>[]).map(s =>
      `<option value="${s.id}" ${sourceId === s.id ? 'selected' : ''}>${s.name}</option>`).join('');

    const rows = (items as Record<string,unknown>[]).map((i) => {
      const tags: string[] = jsonParse(i.tags as string, []);
      const tagBadges = tags.map(t => `<span class="badge b-muted">${t}</span>`).join(' ');
      return `<tr>
<td style="max-width:320px"><a href="/admin/content/${i.id}">
${i.title ? `<strong>${truncate(i.title as string)}</strong>` : truncate(i.text_content as string)}</a></td>
<td><span class="badge b-blue">${i.connector_type}</span></td>
<td>${scoreBar(Number(i.quality_score))}</td>
<td>${scoreBar(Number(i.signal_score))}</td>
<td>${tagBadges}</td>
<td>${fmtDate(i.publish_time as string)}</td>
<td>${i.is_duplicate ? '<span class="badge b-yellow">dup</span>' : ''}</td>
</tr>`;
    }).join('');

    const body = `<h2>Content <span style="color:var(--muted);font-size:.85rem;font-weight:400">(${total} total)</span></h2>
<form method="get" action="/admin/content" class="toolbar" style="margin-bottom:1.5rem">
<div class="filters">
<input type="text" name="search" value="${search ?? ''}" placeholder="Search…">
<select name="source_id"><option value="">All Sources</option>${srcOptions}</select>
<input type="number" name="min_score" value="${minScore ?? ''}" placeholder="Min score" step=".1" min="0" max="1" style="width:90px">
<div class="cb-group"><input type="checkbox" name="hide_duplicates" value="1" id="hd" ${hideDups ? 'checked' : ''}>
<label for="hd" style="margin-bottom:0;font-size:.82rem">Hide dups</label></div>
<button type="submit" class="btn btn-sm btn-primary">Filter</button>
</div></form>
<table><thead><tr><th>Title / Text</th><th>Source</th><th>Quality</th><th>Signal</th><th>Tags</th><th>Published</th><th>Dup</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--muted)">No items found</td></tr>'}</tbody></table>
${pagination(page, totalPages, buildUrl)}`;

    return c.html(layout('Content', '/admin/content', body));
  });

  app.get('/admin/content/:id', async (c) => {
    const item = await dbFirst(c.env, 'SELECT * FROM content_items WHERE id=?', c.req.param('id')) as Record<string,unknown> | null;
    if (!item) return c.html(layout('Not Found', '/admin/content', '<p>Item not found.</p>'));
    const source = await getSource(c.env, item.source_id as string) as Record<string,unknown> | null;
    const tags: string[] = jsonParse(item.tags as string, []);
    const eng = jsonParse<Record<string,unknown>>(item.engagement_snapshot as string, {});
    const engRows = Object.entries(eng).map(([k,v]) => `<p><strong>${k}:</strong> ${v}</p>`).join('');
    const tagBadges = tags.map(t => `<span class="badge b-blue" style="margin:.15rem">${t}</span>`).join('');
    let rawPretty = '{}';
    try { rawPretty = JSON.stringify(JSON.parse(item.raw_data as string ?? '{}'), null, 2); } catch {}

    const body = `<div style="margin-bottom:1rem"><a href="/admin/content" class="btn btn-sm btn-outline">← Back</a></div>
<h2>${item.title ?? 'Untitled Content'}</h2>
<div class="detail-grid">
<div class="detail-card"><h3>Metadata</h3>
<p><strong>Source:</strong> ${source?.name ?? item.source_id}</p>
<p><strong>Connector:</strong> <span class="badge b-blue">${item.connector_type}</span></p>
<p><strong>URL:</strong> <a href="${item.url}" target="_blank">${truncate(item.url as string, 60)}</a></p>
<p><strong>Published:</strong> ${fmtDate(item.publish_time as string)}</p>
<p><strong>Fetched:</strong> ${fmtDate(item.fetch_time as string)}</p>
</div>
<div class="detail-card"><h3>Scores</h3>
<p><strong>Quality:</strong> ${scoreBar(Number(item.quality_score))}</p>
<p><strong>Signal:</strong> ${scoreBar(Number(item.signal_score))}</p>
<p><strong>Duplicate:</strong> ${item.is_duplicate ? '<span class="badge b-yellow">Yes</span>' : '<span class="badge b-green">No</span>'}</p>
<p><strong>Hash:</strong> <code style="font-size:.72rem">${item.content_hash ? String(item.content_hash).slice(0,16) + '…' : '—'}</code></p>
</div>
<div class="detail-card"><h3>Tags</h3>${tagBadges || '<span style="color:var(--muted)">None</span>'}</div>
<div class="detail-card"><h3>Engagement</h3>${engRows || '<span style="color:var(--muted)">No data</span>'}</div>
<div class="detail-card full"><h3>Content</h3>
<div style="white-space:pre-wrap;line-height:1.7">${item.text_content ?? '<em style="color:var(--muted)">No text content</em>'}</div>
</div>
<div class="detail-card full"><h3>Raw Data</h3><pre>${rawPretty}</pre></div>
</div>`;

    return c.html(layout('Content Detail', '/admin/content', body));
  });

  // ─── Settings ────────────────────────────────────────────────────────────────
  app.get('/admin/settings', async (c) => {
    const s = await getAllSettings(c.env);
    const intervalOpts = [5, 10, 15, 30, 60, 120, 360, 720, 1440].map((m) => {
      const label = m < 60 ? `${m} minutes` : m < 1440 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m / 1440} day`;
      const sel = String(s.cron_interval_minutes ?? '30') === String(m) ? 'selected' : '';
      return `<option value="${m}" ${sel}>${label}</option>`;
    }).join('');

    const enabled = (s.cron_enabled ?? '1') === '1';

    const body = `<h2>Settings</h2>
<form method="post" action="/admin/settings" style="max-width:520px">
  <div class="detail-card" style="margin-bottom:1.5rem">
    <h3>Cron Schedule</h3>
    <p style="color:var(--muted);font-size:.82rem;margin-bottom:1rem">
      Cloudflare cron ticks every 5 minutes. The interval below controls how often sources actually run.
    </p>
    <div class="form-group">
      <label>Run sources every</label>
      <select name="cron_interval_minutes">${intervalOpts}</select>
    </div>
    <div class="form-group">
      <div class="cb-group">
        <input type="checkbox" name="cron_enabled" value="1" id="ce" ${enabled ? 'checked' : ''}>
        <label for="ce" style="margin-bottom:0">Cron enabled (uncheck to pause all automatic runs)</label>
      </div>
    </div>
  </div>

  <div class="detail-card" style="margin-bottom:1.5rem">
    <h3>Current Status</h3>
    <p><strong>Cron:</strong> <span class="badge ${enabled ? 'b-green' : 'b-red'}">${enabled ? 'enabled' : 'paused'}</span></p>
    <p><strong>Interval:</strong> every ${s.cron_interval_minutes ?? 30} minutes</p>
    <p><strong>Last cron run:</strong> ${fmtDate(s.last_cron_run_at ?? null)}</p>
    <p><strong>Next run approx:</strong> ${s.last_cron_run_at
      ? fmtDate(new Date(new Date(s.last_cron_run_at).getTime() + Number(s.cron_interval_minutes ?? 30) * 60_000).toISOString())
      : '—'}</p>
  </div>

  <button type="submit" class="btn btn-primary">Save Settings</button>
</form>`;
    return c.html(layout('Settings', '/admin/settings', body));
  });

  app.post('/admin/settings', async (c) => {
    const f = await c.req.formData();
    await setSetting(c.env, 'cron_interval_minutes', f.get('cron_interval_minutes') as string ?? '30');
    await setSetting(c.env, 'cron_enabled', f.get('cron_enabled') === '1' ? '1' : '0');
    return c.redirect('/admin/settings');
  });

  return app;
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

function sourceForm(s: Record<string,unknown> | null): string {
  const action = s ? `/admin/sources/${s.id}/edit` : '/admin/sources/new';
  const title = s ? 'Edit Source' : 'New Source';
  const ctOpts = CONNECTOR_TYPES.map(ct =>
    `<option value="${ct}" ${s?.connector_type === ct ? 'selected' : ''}>${ct}</option>`).join('');
  const smOpts = SOURCE_MODES.map(sm =>
    `<option value="${sm}" ${s?.source_mode === sm ? 'selected' : ''}>${sm}</option>`).join('');
  const tags = s ? jsonParse<string[]>(s.tags as string, []).join(', ') : '';
  const config = s ? (() => { try { return JSON.stringify(JSON.parse(s.config as string), null, 2); } catch { return '{}'; } })() : '{}';

  return `<h2>${title}</h2>
<form method="post" action="${action}" style="max-width:600px">
<div class="form-group"><label>Name</label>
<input type="text" name="name" value="${s?.name ?? ''}" required></div>
<div class="form-group"><label>Connector Type</label>
<select name="connector_type">${ctOpts}</select></div>
<div class="form-group"><label>Source Mode</label>
<select name="source_mode">${smOpts}</select></div>
<div class="form-group"><label>URL or Handle</label>
<input type="text" name="url_or_handle" value="${s?.url_or_handle ?? ''}" placeholder="Feed URL, channel ID, page ID…"></div>
<div class="form-group"><label>Config (JSON)</label>
<textarea name="config_json" style="font-family:monospace">${config}</textarea></div>
<div class="form-group"><label>Tags (comma-separated)</label>
<input type="text" name="tags_str" value="${tags}" placeholder="tech, news, competitor"></div>
<div class="form-group"><label>Priority (1=high, 10=low)</label>
<input type="number" name="priority" value="${s?.priority ?? 5}" min="1" max="10"></div>
${s ? `<div class="form-group"><div class="cb-group">
<input type="checkbox" name="is_active" value="on" id="ia" ${s.is_active ? 'checked' : ''}>
<label for="ia" style="margin-bottom:0">Active</label></div></div>` : ''}
<div style="display:flex;gap:.75rem;margin-top:1.5rem">
<button type="submit" class="btn btn-primary">${s ? 'Update' : 'Create'} Source</button>
<a href="/admin/sources" class="btn btn-outline">Cancel</a>
</div></form>`;
}

function keywordForm(k: Record<string,unknown> | null): string {
  const action = k ? `/admin/keywords/${k.id}/edit` : '/admin/keywords/new';
  const mmOpts = MATCH_MODES.map(m =>
    `<option value="${m}" ${k?.match_mode === m ? 'selected' : ''}>${m}</option>`).join('');
  return `<h2>${k ? 'Edit' : 'New'} Keyword</h2>
<form method="post" action="${action}" style="max-width:480px">
<div class="form-group"><label>Keyword</label>
<input type="text" name="keyword" value="${k?.keyword ?? ''}" required></div>
<div class="form-group"><label>Category</label>
<input type="text" name="category" value="${k?.category ?? 'general'}" placeholder="general, competitor, product…"></div>
<div class="form-group"><label>Match Mode</label>
<select name="match_mode">${mmOpts}</select></div>
${k ? `<div class="form-group"><div class="cb-group">
<input type="checkbox" name="is_active" value="on" id="ia" ${k.is_active ? 'checked' : ''}>
<label for="ia" style="margin-bottom:0">Active</label></div></div>` : ''}
<div style="display:flex;gap:.75rem;margin-top:1.5rem">
<button type="submit" class="btn btn-primary">${k ? 'Update' : 'Create'}</button>
<a href="/admin/keywords" class="btn btn-outline">Cancel</a>
</div></form>`;
}

function goalForm(g: Record<string,unknown> | null, allKws: Record<string,unknown>[], selectedIds: string[]): string {
  const action = g ? `/admin/goals/${g.id}/edit` : '/admin/goals/new';
  const kwChecks = allKws.map(kw => `<div class="cb-group" style="margin-bottom:.3rem">
<input type="checkbox" name="keyword_ids" value="${kw.id}" id="kw_${kw.id}" ${selectedIds.includes(kw.id as string) ? 'checked' : ''}>
<label for="kw_${kw.id}" style="margin-bottom:0">${kw.keyword} <span style="color:var(--muted)">(${kw.category})</span></label>
</div>`).join('');

  return `<h2>${g ? 'Edit' : 'New'} Goal</h2>
<form method="post" action="${action}" style="max-width:600px">
<div class="form-group"><label>Name</label>
<input type="text" name="name" value="${g?.name ?? ''}" required></div>
<div class="form-group"><label>Description</label>
<textarea name="description">${g?.description ?? ''}</textarea></div>
<div class="form-group"><label>Priority</label>
<input type="number" name="priority" value="${g?.priority ?? 5}" min="1" max="10"></div>
<div class="form-group"><label>Linked Keywords</label>
${kwChecks || '<p style="color:var(--muted);font-size:.85rem">No active keywords. <a href="/admin/keywords/new">Create one first.</a></p>'}
</div>
${g ? `<div class="form-group"><div class="cb-group">
<input type="checkbox" name="is_active" value="on" id="ia" ${g.is_active ? 'checked' : ''}>
<label for="ia" style="margin-bottom:0">Active</label></div></div>` : ''}
<div style="display:flex;gap:.75rem;margin-top:1.5rem">
<button type="submit" class="btn btn-primary">${g ? 'Update' : 'Create'}</button>
<a href="/admin/goals" class="btn btn-outline">Cancel</a>
</div></form>`;
}

function scheduleForm(s: Record<string,unknown> | null, sources: Record<string,unknown>[]): string {
  const action = s ? `/admin/schedules/${s.id}/edit` : '/admin/schedules/new';
  const srcOpts = sources.map(src =>
    `<option value="${src.id}" ${s?.source_id === src.id ? 'selected' : ''}>${src.name} (${src.connector_type})</option>`).join('');

  return `<h2>${s ? 'Edit' : 'New'} Schedule</h2>
<form method="post" action="${action}" style="max-width:480px">
<div class="form-group"><label>Source</label>
<select name="source_id">${srcOpts}</select></div>
<div class="form-group"><label>Cron Expression</label>
<input type="text" name="cron_expression" value="${s?.cron_expression ?? '*/30 * * * *'}" placeholder="*/30 * * * *">
<small style="color:var(--muted)">Min Hour Day Month Weekday — e.g. */30 * * * * = every 30 min</small></div>
${s ? `<div class="form-group"><div class="cb-group">
<input type="checkbox" name="is_active" value="on" id="ia" ${s.is_active ? 'checked' : ''}>
<label for="ia" style="margin-bottom:0">Active</label></div></div>` : ''}
<div style="display:flex;gap:.75rem;margin-top:1.5rem">
<button type="submit" class="btn btn-primary">${s ? 'Update' : 'Create'}</button>
<a href="/admin/schedules" class="btn btn-outline">Cancel</a>
</div></form>`;
}
