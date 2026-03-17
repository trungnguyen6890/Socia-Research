import { Hono } from 'hono';
import { Env } from './types';
import { createAdminRouter } from './admin/routes';
import { createApiRouter } from './api/routes';
import { runSourcePipeline } from './pipeline/runner';
import { getSources, getSetting, setSetting } from './db';
import { LANDING_HTML } from './landing';

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
  console.log(`Cron tick: ${event.cron}`);

  // Check if cron is enabled
  const enabled = await getSetting(env, 'cron_enabled', '1');
  if (enabled !== '1') {
    console.log('Cron is paused via settings — skipping.');
    return;
  }

  // Check interval: only run if enough time has passed since last run
  const intervalMinutes = Number(await getSetting(env, 'cron_interval_minutes', '30'));
  const lastRunAt = await getSetting(env, 'last_cron_run_at', '');
  if (lastRunAt) {
    const elapsedMs = Date.now() - new Date(lastRunAt).getTime();
    const intervalMs = intervalMinutes * 60_000;
    if (elapsedMs < intervalMs) {
      const waitMin = Math.ceil((intervalMs - elapsedMs) / 60_000);
      console.log(`Interval not reached — next run in ~${waitMin}min. Skipping.`);
      return;
    }
  }

  // Record run start time
  await setSetting(env, 'last_cron_run_at', new Date().toISOString());

  const sources = await getSources(env, true);
  console.log(`Running pipeline for ${sources.length} active sources (interval: ${intervalMinutes}min)`);

  for (const source of sources) {
    try {
      const result = await runSourcePipeline(source as never, env);
      console.log(`Source ${(source as Record<string, unknown>).name}: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`Source ${(source as Record<string, unknown>).id} failed:`, err);
    }
  }
}

// ─── Worker export ────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env, event));
  },
};
