import { Env, FetchResult, SourceRow } from '../types';
import { jsonParse } from '../db';

export abstract class BaseConnector {
  protected source: SourceRow;
  protected env: Env;
  protected config: Record<string, unknown>;

  constructor(source: SourceRow, env: Env) {
    this.source = source;
    this.env = env;
    this.config = jsonParse<Record<string, unknown>>(source.config, {});
  }

  abstract fetch(sinceCursor: string | null): Promise<FetchResult>;

  protected maxResults(): number {
    return (this.config.max_results as number) ?? 25;
  }

  protected async rateLimitedFetch(url: string, init?: RequestInit): Promise<Response> {
    const key = `rl:${this.source.connector_type}`;
    const windowMs = 60_000;
    const maxReqs = this.maxRateLimit();

    // Simple sliding window using KV
    const now = Date.now();
    const windowStart = now - windowMs;
    const raw = await this.env.RATE_KV.get(key);
    const timestamps: number[] = raw ? JSON.parse(raw) : [];
    const recent = timestamps.filter((t) => t > windowStart);

    if (recent.length >= maxReqs) {
      const waitMs = recent[0] - windowStart + 100;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 5000)));
    }

    recent.push(now);
    await this.env.RATE_KV.put(key, JSON.stringify(recent), { expirationTtl: 120 });

    return fetch(url, init);
  }

  protected maxRateLimit(): number {
    const limits: Record<string, number> = {
      rss: 60, website: 10, youtube: 90,
      telegram: 30, instagram_pro: 200,
    };
    return limits[this.source.connector_type] ?? 30;
  }
}
