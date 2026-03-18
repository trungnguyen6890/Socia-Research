import puppeteer from '@cloudflare/puppeteer';
import type { Env } from './types';

/**
 * Launch a browser with automatic retry on 429 (CF Browser Rendering rate limit).
 *
 * CF Browser Rendering limits: 2 concurrent sessions.
 * When multiple browser-based sources run close together (cron + manual run),
 * this retries with increasing backoff instead of failing immediately.
 */
export async function launchBrowser(
  env: Env,
  maxRetries = 3,
): Promise<import('@cloudflare/puppeteer').Browser> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await puppeteer.launch(env.BROWSER);
    } catch (err) {
      const msg = String(err);
      const is429 = msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('unable to create');
      if (is429 && attempt < maxRetries) {
        const delaySec = (attempt + 1) * 15; // 15s, 30s, 45s
        console.log(`Browser session limit (429) — waiting ${delaySec}s before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(r => setTimeout(r, delaySec * 1000));
        continue;
      }
      throw new Error(`Browser launch failed after ${attempt} retries: ${msg}`);
    }
  }
  throw new Error('unreachable');
}

export const BROWSER_CONNECTOR_TYPES = new Set(['x_browser', 'telegram']);
