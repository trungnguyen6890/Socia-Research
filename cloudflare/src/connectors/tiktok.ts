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

      // Apply stealth patches to bypass TikTok's headless browser detection.
      // Without these, TikTok serves the page but never triggers the video list API.
      await page.evaluateOnNewDocument(getStealthScript());

      // Hook Response.prototype.json to capture video list API responses.
      // TikTok streams XHR body so CDP/page.on('response') returns empty.
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

      await page.goto(`https://www.tiktok.com/@${username}`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      const title = await page.title();
      const hasCaptcha = await page.evaluate(() =>
        !!document.querySelector('[class*="captcha"], [id*="captcha"]')
      );
      if (hasCaptcha) throw new Error(`TikTok showed CAPTCHA for @${username}`);

      // Scroll 5× to trigger progressive video list API calls.
      // TikTok uses a virtual scroll container so window.scrollY stays 0 —
      // videos load via IntersectionObserver/timer, not window scroll position.
      // Scroll all common containers to ensure the trigger fires.
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => {
          window.scrollBy(0, 1200);
          document.documentElement.scrollTop += 1200;
          document.body.scrollTop += 1200;
          // Also scroll TikTok's inner scroll container if present
          const scroller = document.querySelector('[class*="DivVideoFeedV2"], [class*="DivUserPostList"], main');
          if (scroller) (scroller as HTMLElement).scrollTop += 1200;
        });
        await new Promise(r => setTimeout(r, 2500));
      }

      const allVideos = await page.evaluate(
        () => (window as Record<string, unknown>)['__ttVideos'] as TikTokVideo[]
      );

      // Filter to only videos from the target user — the hook captures ALL itemList
      // responses on the page, including related/suggested videos from other accounts.
      const lowerUser = username.toLowerCase();
      const videos = (allVideos ?? []).filter(v =>
        !v.author?.uniqueId || v.author.uniqueId.toLowerCase() === lowerUser
      );

      console.log(`tiktok browser @${username}: title="${title}", captured=${allVideos?.length ?? 0} total, ${videos.length} from @${username}`);

      if (!videos.length) {
        throw new Error(`TikTok: 0 videos for @${username} (title="${title}", total captured=${allVideos?.length ?? 0})`);
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

    const lowerUser = username.toLowerCase();
    for (const video of videos) {
      if (!video.id) continue;
      // Skip videos from other users (can appear in suggested/related API responses)
      if (video.author?.uniqueId && video.author.uniqueId.toLowerCase() !== lowerUser) continue;
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
