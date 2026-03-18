import { BaseConnector } from './base';
import { launchBrowser } from '../browser';
import { getStealthScript } from '../stealth';
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

      // Try to get videos directly from SSR data
      const videos = this.parseVideosFromHtml(html);
      if (videos.length) {
        console.log(`tiktok HTTP: found ${videos.length} videos for @${username}`);
        return this.convertVideos(videos, username, sinceCursor);
      }

      // SSR didn't have video data, but it has secUid.
      // Try calling TikTok's API directly with the secUid.
      const secUid = this.extractSecUid(html);
      if (secUid) {
        console.log(`tiktok HTTP: no SSR videos, trying API with secUid for @${username}`);
        const apiVideos = await this.fetchViaApi(secUid, res.headers.get('set-cookie'));
        if (apiVideos.length) {
          console.log(`tiktok HTTP+API: found ${apiVideos.length} videos for @${username}`);
          return this.convertVideos(apiVideos, username, sinceCursor);
        }
      }

      console.log(`tiktok HTTP: 0 videos for @${username} (bodyLen=${html.length})`);
      return null;
    } catch (err) {
      console.log(`tiktok HTTP error for @${username}: ${err}`);
      return null;
    }
  }

  private extractSecUid(html: string): string | null {
    const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]+?)<\/script>/);
    if (!match) return null;
    try {
      const data = JSON.parse(match[1]) as Record<string, unknown>;
      const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
      const userDetail = scope?.['webapp.user-detail'] as Record<string, unknown> | undefined;
      const userInfo = userDetail?.['userInfo'] as Record<string, unknown> | undefined;
      const user = userInfo?.['user'] as Record<string, unknown> | undefined;
      return (user?.['secUid'] as string) || null;
    } catch {
      return null;
    }
  }

  private async fetchViaApi(secUid: string, cookies: string | null): Promise<TikTokVideo[]> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/',
        'Accept': 'application/json',
      };
      if (cookies) headers['Cookie'] = cookies;

      const url = `https://www.tiktok.com/api/post/item_list/?WebIdLastTime=${Math.floor(Date.now() / 1000)}&aid=1988&app_language=en&app_name=tiktok_web&count=30&secUid=${encodeURIComponent(secUid)}&cursor=0&coverFormat=2&from_page=user&device_platform=web_pc`;
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.log(`tiktok API: ${res.status}`);
        return [];
      }
      const json = await res.json() as Record<string, unknown>;
      const items = (json['itemList'] as TikTokVideo[] | undefined) ?? (json['aweme_list'] as TikTokVideo[] | undefined) ?? [];
      return items;
    } catch (err) {
      console.log(`tiktok API error: ${err}`);
      return [];
    }
  }

  private parseVideosFromHtml(html: string): TikTokVideo[] {
    // Strategy A: __UNIVERSAL_DATA_FOR_REHYDRATION__ (current TikTok SSR format)
    const rehydrationMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]+?)<\/script>/);
    if (rehydrationMatch) {
      try {
        const data = JSON.parse(rehydrationMatch[1]) as Record<string, unknown>;
        const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
        if (scope) {
          console.log(`tiktok SSR scopeKeys: ${Object.keys(scope).join(', ')}`);
          for (const value of Object.values(scope)) {
            const v = value as Record<string, unknown> | null | undefined;
            const items =
              (v?.['videoList'] as Record<string, unknown> | undefined)?.['items'] ??
              (v?.['itemList'] as unknown[]) ??
              (v?.['items'] as unknown[]) ??
              null;
            if (Array.isArray(items) && items.length > 0) {
              console.log(`tiktok SSR: found ${items.length} videos via __UNIVERSAL_DATA`);
              return items as TikTokVideo[];
            }
          }
        }
      } catch {
        console.log('tiktok: failed to parse __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON');
      }
    }

    // Strategy B: SIGI_STATE (older TikTok SSR format)
    const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]+?)<\/script>/);
    if (sigiMatch) {
      try {
        const data = JSON.parse(sigiMatch[1]) as Record<string, unknown>;
        const itemModule = data['ItemModule'] as Record<string, unknown> | undefined;
        if (itemModule) {
          const items = Object.values(itemModule) as TikTokVideo[];
          if (items.length > 0) {
            console.log(`tiktok SSR: found ${items.length} videos via SIGI_STATE`);
            return items;
          }
        }
      } catch {
        console.log('tiktok: failed to parse SIGI_STATE JSON');
      }
    }

    // Strategy C: __NEXT_DATA__ (alternative SSR format)
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (nextMatch) {
      try {
        const data = JSON.parse(nextMatch[1]) as Record<string, unknown>;
        const props = data['props'] as Record<string, unknown> | undefined;
        const pageProps = props?.['pageProps'] as Record<string, unknown> | undefined;
        const items = pageProps?.['items'] as unknown[] | undefined;
        if (Array.isArray(items) && items.length > 0) {
          console.log(`tiktok SSR: found ${items.length} videos via __NEXT_DATA__`);
          return items as TikTokVideo[];
        }
      } catch {
        console.log('tiktok: failed to parse __NEXT_DATA__ JSON');
      }
    }

    // Strategy D: Extract video URLs from raw HTML via regex
    // TikTok embeds video links like /@username/video/1234567890 throughout the page
    const videoIdPattern = /\/@[\w.]+\/video\/(\d+)/g;
    const ids = new Set<string>();
    let m;
    while ((m = videoIdPattern.exec(html)) !== null) {
      ids.add(m[1]);
    }
    if (ids.size > 0) {
      console.log(`tiktok SSR: found ${ids.size} video IDs via HTML regex`);
      return Array.from(ids).map(id => ({ id } as TikTokVideo));
    }

    console.log(`tiktok: no videos found in HTML (len=${html.length}, hasRehydration=${!!rehydrationMatch}, hasSigi=${!!sigiMatch}, hasNext=${!!nextMatch})`);
    return [];
  }

  // ─── Strategy 2: CF Browser ───────────────────────────────────────────────

  private async fetchViaBrowser(username: string, sinceCursor: string | null): Promise<FetchResult> {
    const browser = await launchBrowser(this.env);
    try {
      const page = await browser.newPage();
      // Use desktop Chrome UA — CF Browser Rendering runs desktop Chromium,
      // so mobile UA creates a mismatch that TikTok can detect.
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1920, height: 1080 });

      // Apply stealth patches to bypass TikTok's headless browser detection.
      await page.evaluateOnNewDocument(getStealthScript());

      // Hook Response.prototype.json to capture video list API responses.
      await page.evaluateOnNewDocument(() => {
        const origJson = Response.prototype.json;
        (window as Record<string, unknown>)['__ttVideos'] = [];
        Response.prototype.json = async function () {
          const result = await origJson.call(this) as Record<string, unknown>;
          if (Array.isArray(result?.['itemList']) && (result['itemList'] as unknown[]).length > 0)
            ((window as Record<string, unknown>)['__ttVideos'] as unknown[]).push(...result['itemList'] as unknown[]);
          if (Array.isArray(result?.['aweme_list']) && (result['aweme_list'] as unknown[]).length > 0)
            ((window as Record<string, unknown>)['__ttVideos'] as unknown[]).push(...result['aweme_list'] as unknown[]);
          return result;
        };
      });

      // Two-step navigation: load TikTok main page first to establish session,
      // then navigate to profile. This mimics natural browsing and may bypass
      // detection that triggers when navigating directly to a profile.
      await page.goto('https://www.tiktok.com/foryou', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }).catch(() => { /* ignore foryou load errors */ });
      await new Promise(r => setTimeout(r, 2000));

      await page.goto(`https://www.tiktok.com/@${username}`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      const title = await page.title();
      console.log(`tiktok browser @${username}: page loaded, title="${title}"`);

      const hasCaptcha = await page.evaluate(() =>
        !!document.querySelector('[class*="captcha"], [id*="captcha"]')
      );
      if (hasCaptcha) throw new Error(`TikTok showed CAPTCHA for @${username}`);

      // Try extracting SSR data from the browser-rendered page first.
      // Even if stealth fails, the initial HTML should contain __UNIVERSAL_DATA_FOR_REHYDRATION__.
      const ssrVideos = await page.evaluate(() => {
        const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')
          || document.getElementById('SIGI_STATE')
          || document.getElementById('__NEXT_DATA__');
        if (!el?.textContent) return [];
        try {
          const data = JSON.parse(el.textContent) as Record<string, unknown>;
          // __UNIVERSAL_DATA_FOR_REHYDRATION__ path
          const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
          if (scope) {
            for (const value of Object.values(scope)) {
              const v = value as Record<string, unknown> | null;
              const items =
                (v?.['videoList'] as Record<string, unknown> | undefined)?.['items'] ??
                (v?.['itemList'] as unknown[]) ??
                (v?.['items'] as unknown[]) ??
                null;
              if (Array.isArray(items) && items.length > 0) return items;
            }
          }
          // SIGI_STATE path
          const itemModule = data['ItemModule'] as Record<string, unknown> | undefined;
          if (itemModule) {
            return Object.values(itemModule);
          }
          // __NEXT_DATA__ path
          const props = data['props'] as Record<string, unknown> | undefined;
          const pageProps = props?.['pageProps'] as Record<string, unknown> | undefined;
          const items = pageProps?.['items'] as unknown[] | undefined;
          if (Array.isArray(items) && items.length > 0) return items;
        } catch { /* ignore parse errors */ }
        return [];
      }) as TikTokVideo[];

      console.log(`tiktok browser @${username}: SSR data found ${ssrVideos.length} videos`);

      if (ssrVideos.length > 0) {
        return this.convertVideos(ssrVideos, username, sinceCursor);
      }

      // Scroll to trigger progressive video list API calls.
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => {
          window.scrollBy(0, 1200);
          document.documentElement.scrollTop += 1200;
          document.body.scrollTop += 1200;
          const scroller = document.querySelector('[class*="DivVideoFeedV2"], [class*="DivUserPostList"], main');
          if (scroller) (scroller as HTMLElement).scrollTop += 1200;
        });
        await new Promise(r => setTimeout(r, 2500));
      }

      // Strategy 2a: Get videos from API hook
      const allVideos = await page.evaluate(
        () => (window as Record<string, unknown>)['__ttVideos'] as TikTokVideo[]
      );
      const lowerUser = username.toLowerCase();
      const apiVideos = (allVideos ?? []).filter(v =>
        !v.author?.uniqueId || v.author.uniqueId.toLowerCase() === lowerUser
      );

      console.log(`tiktok browser @${username}: API hook captured=${allVideos?.length ?? 0} total, ${apiVideos.length} from @${username}`);

      if (apiVideos.length > 0) {
        return this.convertVideos(apiVideos, username, sinceCursor);
      }

      // Strategy 2b: Direct API call from browser context.
      // Extract secUid from SSR and call TikTok's API with the browser's cookies/session.
      const apiDirectVideos = await page.evaluate(async () => {
        try {
          const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if (!el?.textContent) return [];
          const data = JSON.parse(el.textContent);
          const scope = data['__DEFAULT_SCOPE__'] || {};
          const userDetail = scope['webapp.user-detail'] || {};
          const userInfo = userDetail['userInfo'] || {};
          const user = userInfo['user'] || {};
          const secUid = user['secUid'];
          if (!secUid) return [];

          const res = await fetch(
            `/api/post/item_list/?WebIdLastTime=${Math.floor(Date.now()/1000)}&aid=1988&app_language=en&app_name=tiktok_web&count=30&secUid=${encodeURIComponent(secUid)}&cursor=0&coverFormat=2&from_page=user&device_platform=web_pc`,
            { credentials: 'include' }
          );
          if (!res.ok) return [];
          const json = await res.json();
          return json['itemList'] || json['aweme_list'] || [];
        } catch { return []; }
      }) as TikTokVideo[];

      console.log(`tiktok browser @${username}: direct API call found ${apiDirectVideos?.length ?? 0} videos`);

      if (apiDirectVideos && apiDirectVideos.length > 0) {
        return this.convertVideos(apiDirectVideos, username, sinceCursor);
      }

      // Strategy 2c: DOM fallback — scrape video links from the rendered page.
      // Even without the API firing, TikTok renders video thumbnails with links.
      const domVideos = await page.evaluate((user: string) => {
        const results: { id: string; desc: string; url: string }[] = [];
        const seen = new Set<string>();

        // Find all links to videos on this user's profile
        const links = document.querySelectorAll('a[href*="/video/"]');
        for (const a of links) {
          const href = (a as HTMLAnchorElement).href;
          const match = href.match(/\/@([^/]+)\/video\/(\d+)/);
          if (!match) continue;
          const [, author, id] = match;
          if (author.toLowerCase() !== user.toLowerCase()) continue;
          if (seen.has(id)) continue;
          seen.add(id);

          // Try to get description from nearby elements
          const container = a.closest('[class*="DivItemContainer"], [class*="DivVideoCard"], [class*="video-feed-item"]') || a.parentElement;
          const descEl = container?.querySelector('[class*="desc"], [class*="caption"], [class*="DivVideoCardDesc"]');
          const desc = descEl?.textContent?.trim() || '';

          results.push({ id, desc, url: href });
        }

        // Also check for video containers without direct links
        if (results.length === 0) {
          const videoCards = document.querySelectorAll('[data-e2e="user-post-item"], [class*="DivItemContainer"], [class*="video-feed-item"]');
          for (const card of videoCards) {
            const link = card.querySelector('a[href*="/video/"]') as HTMLAnchorElement | null;
            if (!link) continue;
            const match = link.href.match(/\/video\/(\d+)/);
            if (!match) continue;
            const id = match[1];
            if (seen.has(id)) continue;
            seen.add(id);
            results.push({ id, desc: '', url: link.href });
          }
        }

        return results;
      }, username);

      console.log(`tiktok browser @${username}: DOM fallback found ${domVideos.length} videos`);

      if (domVideos.length > 0) {
        const converted: TikTokVideo[] = domVideos.map(v => ({
          id: v.id,
          desc: v.desc,
          _url: v.url,
        } as TikTokVideo & { _url: string }));
        return this.convertVideos(converted, username, sinceCursor);
      }

      // Strategy 2d: Last resort — extract video IDs from page HTML source
      const htmlVideos = await page.evaluate((user: string) => {
        const html = document.documentElement.innerHTML;
        const pattern = new RegExp(`@${user}/video/(\\d+)`, 'gi');
        const ids = new Set<string>();
        let m;
        while ((m = pattern.exec(html)) !== null) {
          ids.add(m[1]);
        }
        return Array.from(ids);
      }, username);

      console.log(`tiktok browser @${username}: HTML regex found ${htmlVideos.length} video IDs`);

      if (htmlVideos.length > 0) {
        const converted: TikTokVideo[] = htmlVideos.map(id => ({
          id,
          _url: `https://www.tiktok.com/@${username}/video/${id}`,
        } as TikTokVideo & { _url: string }));
        return this.convertVideos(converted, username, sinceCursor);
      }

      throw new Error(`TikTok: 0 videos for @${username} via all strategies (title="${title}", api=${allVideos?.length ?? 0}, dom=0, html=0)`);
    } finally {
      await browser.close();
    }
  }

  // ─── Conversion ───────────────────────────────────────────────────────────

  private convertVideos(videos: TikTokVideo[], username: string, sinceCursor: string | null): FetchResult {
    const rawItems: RawItem[] = [];
    let latestId: string | null = null;
    const maxResults = this.maxResults();

    const lowerUser = username.toLowerCase();
    for (const video of videos) {
      if (!video.id) continue;
      // Skip videos from other users (can appear in suggested/related API responses).
      // If the video has author info and it doesn't match, skip it.
      // If the video has author info with a nickname but no uniqueId, also skip
      // (TikTok suggested videos always have author.uniqueId).
      const authorId = video.author?.uniqueId?.toLowerCase();
      if (authorId && authorId !== lowerUser) continue;
      if (video.author?.nickname && !authorId) continue;
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
