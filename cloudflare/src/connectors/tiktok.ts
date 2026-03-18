import { BaseConnector } from './base';
import { launchBrowser } from '../browser';
import { FetchResult, RawItem } from '../types';

/**
 * TikTok connector — user profile videos.
 *
 * Strategy:
 *   1. Plain HTTP fetch → parse __UNIVERSAL_DATA_FOR_REHYDRATION__ from SSR HTML (free, fast)
 *   2. CF Browser fallback if TikTok returns a bot-check page or empty data
 *
 * source.url_or_handle — @username, username, or full tiktok.com URL
 *
 * config keys:
 *   max_results  — max videos (default: 20)
 */
export class TikTokConnector extends BaseConnector {

  private extractUsername(): string {
    let h = this.source.url_or_handle.trim();
    h = h.replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '');
    h = h.split('/')[0].split('?')[0];
    h = h.replace(/^@/, '');
    return h;
  }

  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const username = this.extractUsername();
    if (!username) throw new Error('No TikTok username in url_or_handle');

    // Attempt 1: lightweight HTTP fetch (no browser session consumed)
    const httpResult = await this.fetchViaHttp(username, sinceCursor);
    if (httpResult) return httpResult;

    // Attempt 2: CF Browser (JS-rendered, costs a browser session)
    console.log(`tiktok @${username}: HTTP failed, trying CF Browser`);
    return await this.fetchViaBrowser(username, sinceCursor);
  }

  // ─── Strategy 1: HTTP + SSR data extraction ───────────────────────────────

  private async fetchViaHttp(username: string, sinceCursor: string | null): Promise<FetchResult | null> {
    try {
      const res = await fetch(`https://www.tiktok.com/@${username}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        console.log(`tiktok HTTP: ${res.status} for @${username}`);
        return null;
      }

      const html = await res.text();
      const videos = this.parseVideosFromHtml(html);

      if (!videos.length) {
        console.log(`tiktok HTTP: 0 videos in SSR data for @${username} (bodyLen=${html.length})`);
        return null;
      }

      console.log(`tiktok HTTP: found ${videos.length} videos for @${username}`);
      return this.convertVideos(videos, username, sinceCursor);
    } catch (err) {
      console.log(`tiktok HTTP error for @${username}: ${err}`);
      return null;
    }
  }

  private parseVideosFromHtml(html: string): TikTokVideo[] {
    // TikTok embeds initial state in <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">
    const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]+?)<\/script>/);
    if (!match) {
      console.log('tiktok: __UNIVERSAL_DATA_FOR_REHYDRATION__ not found in HTML');
      return [];
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(match[1]);
    } catch {
      console.log('tiktok: failed to parse __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON');
      return [];
    }

    // Try every known scope path
    const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
    if (!scope) {
      console.log('tiktok: no __DEFAULT_SCOPE__ in SSR data');
      return [];
    }

    console.log(`tiktok SSR scopeKeys: ${Object.keys(scope).join(', ')}`);

    for (const value of Object.values(scope)) {
      const v = value as Record<string, unknown> | null | undefined;
      const items =
        (v?.['videoList'] as Record<string, unknown> | undefined)?.['items'] ??
        (v?.['itemList'] as unknown[]) ??
        (v?.['items'] as unknown[]) ??
        null;
      if (Array.isArray(items) && items.length > 0) return items as TikTokVideo[];
    }

    console.log('tiktok: no video items found in any scope key');
    return [];
  }

  // ─── Strategy 2: CF Browser ───────────────────────────────────────────────

  private async fetchViaBrowser(username: string, sinceCursor: string | null): Promise<FetchResult> {
    const browser = await launchBrowser(this.env);
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      );
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true });

      await page.goto(`https://www.tiktok.com/@${username}`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Scroll to trigger lazy-loaded video grid, then wait for XHR to settle
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 4000));

      // Wait explicitly for video items if not yet visible
      await page.waitForSelector(
        'a[href*="/video/"], [data-e2e="user-post-item"]',
        { timeout: 8000 }
      ).catch(() => {});

      const result = await page.evaluate(() => {
        const info: Record<string, unknown> = {
          title: document.title,
          url: window.location.href,
          hasCaptcha: !!document.querySelector('[class*="captcha"], [id*="captcha"]'),
          scopeKeys: [] as string[],
          videos: null as unknown[] | null,
        };

        // ── Method 1: __UNIVERSAL_DATA_FOR_REHYDRATION__ ──
        const scriptEl = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
        if (scriptEl?.textContent) {
          try {
            const data = JSON.parse(scriptEl.textContent);
            const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
            if (scope) {
              info.scopeKeys = Object.keys(scope);
              // Try every known path
              const candidates = [
                scope['webapp.video-list'],
                scope['webapp.user-page'],
                scope['webapp.user-detail'],
                ...Object.values(scope),
              ];
              for (const candidate of candidates) {
                const c = candidate as Record<string, unknown> | null | undefined;
                const items =
                  (c?.['videoList'] as Record<string, unknown> | undefined)?.['items'] ??
                  (c?.['itemList'] as unknown[]) ??
                  (c?.['videos'] as unknown[]) ??
                  null;
                if (Array.isArray(items) && items.length > 0) {
                  info.videos = items;
                  break;
                }
              }
            }
          } catch { /* fall through */ }
        }

        // ── Method 2: scan all scripts for video arrays ──
        if (!info.videos) {
          for (const script of Array.from(document.querySelectorAll('script'))) {
            const text = script.textContent ?? '';
            if (text.length < 100 || text.length > 5_000_000) continue;
            // Look for arrays with TikTok video shape: id + stats + createTime
            const m = text.match(/"id"\s*:\s*"\d{15,}".{0,200}"createTime"\s*:\s*\d+/);
            if (!m) continue;
            // Try to extract the surrounding array
            const arrMatch = text.match(/\[\s*\{[^[]*?"id"\s*:\s*"\d{15,}"[\s\S]{0,50000}?\]\s*[,}]/);
            if (arrMatch) {
              try {
                const arr = JSON.parse(arrMatch[0].replace(/[,}]$/, ']').replace(/^([^[]+)/, '['));
                if (Array.isArray(arr) && arr.length > 0 && arr[0].id) {
                  info.videos = arr;
                  break;
                }
              } catch { /* continue */ }
            }
          }
        }

        // ── Method 3: DOM — extract all /video/ links on the page ──
        if (!info.videos) {
          const seen = new Set<string>();
          const domVideos: Array<Record<string, unknown>> = [];
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]').forEach(a => {
            const href = a.href;
            const idMatch = href.match(/\/video\/(\d+)/);
            if (!idMatch || seen.has(idMatch[1])) return;
            seen.add(idMatch[1]);
            // Try to get alt text from nearby img (caption)
            const img = a.querySelector('img') ?? a.closest('[data-e2e]')?.querySelector('img');
            domVideos.push({
              id: idMatch[1],
              _url: href.split('?')[0],
              desc: img?.getAttribute('alt') ?? '',
            });
          });
          if (domVideos.length > 0) {
            info.videos = domVideos;
            info.method = 'dom';
          }
        }

        return info;
      });

      // Log page state for debugging
      const bodySnippet = await page.evaluate(() => document.body.innerHTML.slice(0, 1000));
      const videoLinkCount = await page.evaluate(() => document.querySelectorAll('a[href*="/video/"]').length);
      console.log(`tiktok browser @${username}: title="${result.title}", captcha=${result.hasCaptcha}, scopeKeys=${JSON.stringify(result.scopeKeys)}, videos=${(result.videos as unknown[] | null)?.length ?? 0}, domVideoLinks=${videoLinkCount}`);
      console.log(`tiktok body snippet: ${bodySnippet.slice(0, 500)}`);

      if (result.hasCaptcha) throw new Error(`TikTok showed CAPTCHA for @${username}`);

      const videos = result.videos as TikTokVideo[] | null;
      if (!videos?.length) {
        throw new Error(
          `TikTok: 0 videos for @${username} ` +
          `(title="${result.title}", scopeKeys=${JSON.stringify(result.scopeKeys)})`
        );
      }

      return this.convertVideos(videos, username, sinceCursor);
    } finally {
      await browser.close();
    }
  }

  // ─── Conversion ───────────────────────────────────────────────────────────

  private convertVideos(videos: TikTokVideo[], username: string, sinceCursor: string | null): FetchResult {
    const rawItems: RawItem[] = [];
    let latestId: string | null = null;
    const maxResults = this.maxResults();

    for (const video of videos) {
      if (!video.id) continue;
      if (rawItems.length >= maxResults) break;
      if (sinceCursor && video.id === sinceCursor) break;
      if (!latestId) latestId = video.id;

      const authorHandle = video.author?.uniqueId ?? username;
      const publishTime = video.createTime
        ? new Date(video.createTime * 1000).toISOString()
        : null;
      // Support DOM-extracted items that carry _url directly
      const videoUrl = (video as Record<string, unknown>)['_url'] as string | undefined
        ?? `https://www.tiktok.com/@${authorHandle}/video/${video.id}`;

      rawItems.push({
        url: videoUrl,
        title: null,
        textContent: video.desc || null,
        publishTime,
        contentType: 'video',
        authorName: video.author?.nickname ?? video.author?.uniqueId ?? this.source.name,
        hasMedia: true,
        engagementSnapshot: {
          views: video.stats?.playCount ?? 0,
          likes: video.stats?.diggCount ?? 0,
          comments: video.stats?.commentCount ?? 0,
          shares: video.stats?.shareCount ?? 0,
        },
      });
    }

    return { rawItems, newCursor: latestId ?? sinceCursor };
  }
}

interface TikTokVideo {
  id: string;
  desc?: string;
  createTime?: number;
  author?: { uniqueId?: string; nickname?: string };
  stats?: {
    playCount?: number;
    diggCount?: number;
    commentCount?: number;
    shareCount?: number;
  };
}
