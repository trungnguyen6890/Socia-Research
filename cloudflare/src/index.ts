import { Hono } from 'hono';
import { Env } from './types';
import { createAdminRouter } from './admin/routes';
import { createApiRouter } from './api/routes';
import { runSourcePipeline } from './pipeline/runner';
import { getSources, getSetting, setSetting } from './db';
import { LANDING_HTML } from './landing';
import { BROWSER_CONNECTOR_TYPES } from './browser';

const app = new Hono<{ Bindings: Env }>();

// Landing page + health check
app.get('/', (c) => c.html(LANDING_HTML));
app.get('/health', (c) => c.json({ status: 'ok', service: 'socia-research' }));

// Mount JSON API (for Next.js dashboard)
app.route('/', createApiRouter());

// Mount admin UI (legacy HTML)
app.route('/', createAdminRouter());

// ─── Cron handler ─────────────────────────────────────────────────────────────
async function handleCron(env: Env, event: ScheduledEvent): Promise<void> {
  const currentHour = new Date().getUTCHours();
  console.log(`Cron tick: ${event.cron} | UTC hour: ${currentHour}`);

  // Check if cron is enabled
  const enabled = await getSetting(env, 'cron_enabled', '1');
  if (enabled !== '1') {
    console.log('Cron is paused via settings — skipping.');
    return;
  }

  // Check if current hour is in the allowed hours list (e.g. "3,12")
  const cronHours = await getSetting(env, 'cron_hours', '3,12');
  const allowedHours = cronHours.split(',').map((h) => Number(h.trim())).filter((h) => !isNaN(h));
  if (!allowedHours.includes(currentHour)) {
    console.log(`Current hour ${currentHour} not in scheduled hours [${allowedHours.join(',')}] — skipping.`);
    return;
  }

  // Record run start time
  await setSetting(env, 'last_cron_run_at', new Date().toISOString());

  const sources = await getSources(env, true);
  console.log(`Running pipeline for ${sources.length} active sources at hour ${currentHour}`);

  // Run non-browser sources first (fast), then browser sources with a gap between each
  // to stay within CF Browser Rendering limits (2 concurrent, 6/min).
  const s = sources as Array<Record<string, unknown>>;
  const nonBrowser = s.filter(src => !BROWSER_CONNECTOR_TYPES.has(src.connector_type as string));
  const browserSources = s.filter(src => BROWSER_CONNECTOR_TYPES.has(src.connector_type as string));

  for (const source of nonBrowser) {
    try {
      const result = await runSourcePipeline(source as never, env);
      console.log(`Source ${source.name}: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`Source ${source.id} failed:`, err);
    }
  }

  for (const source of browserSources) {
    try {
      const result = await runSourcePipeline(source as never, env);
      console.log(`Source ${source.name}: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`Source ${source.id} failed:`, err);
    }
    // Wait between browser sources to release the session before opening the next
    await new Promise(r => setTimeout(r, 5_000));
  }
}

// ─── Worker export ────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env, event));
  },
};
