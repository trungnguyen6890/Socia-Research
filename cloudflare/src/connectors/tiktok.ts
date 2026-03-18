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

    // Navigate: data.__DEFAULT_SCOPE__['webapp.video-list'].videoList.items
    try {
      const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown>;
      const videoListScope = scope['webapp.video-list'] as Record<string, unknown>;
      const videoList = videoListScope['videoList'] as Record<string, unknown>;
      const items = videoList['items'] as TikTokVideo[];
      return Array.isArray(items) ? items : [];
    } catch {
      // Try alternate path: data.__DEFAULT_SCOPE__['webapp.user-page']
      try {
        const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown>;
        const userPage = scope['webapp.user-page'] as Record<string, unknown>;
        const videoList = userPage['videoList'] as Record<string, unknown>;
        const items = videoList['items'] as TikTokVideo[];
        return Array.isArray(items) ? items : [];
      } catch {
        console.log('tiktok: could not find video items in SSR data');
        return [];
      }
    }
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
      await new Promise(r => setTimeout(r, 3000));

      const videos = await page.evaluate(() => {
        // Primary: __UNIVERSAL_DATA_FOR_REHYDRATION__ script tag
        const scriptEl = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
        if (scriptEl?.textContent) {
          try {
            const data = JSON.parse(scriptEl.textContent);
            const scope = data['__DEFAULT_SCOPE__'];
            const items =
              scope?.['webapp.video-list']?.videoList?.items ??
              scope?.['webapp.user-page']?.videoList?.items ??
              null;
            if (Array.isArray(items) && items.length > 0) return items;
          } catch { /* fall through */ }
        }

        // Fallback: scan all script tags for SIGI_STATE or similar
        for (const script of Array.from(document.querySelectorAll('script'))) {
          const text = script.textContent ?? '';
          if (!text.includes('"videoList"')) continue;
          const m = text.match(/"items"\s*:\s*(\[[\s\S]+?\])\s*,\s*"cursor"/);
          if (m) {
            try { return JSON.parse(m[1]); } catch { /* continue */ }
          }
        }
        return null;
      });

      const pageState = await page.evaluate(() => ({
        title: document.title,
        url: window.location.href,
        hasCaptcha: !!document.querySelector('[class*="captcha"], [id*="captcha"]'),
      }));

      console.log(`tiktok browser @${username}: title="${pageState.title}", captcha=${pageState.hasCaptcha}, videos=${videos?.length ?? 0}`);

      if (pageState.hasCaptcha) throw new Error(`TikTok showed CAPTCHA for @${username}`);
      if (!videos || !videos.length) throw new Error(`TikTok: 0 videos found for @${username} (title="${pageState.title}")`);

      return this.convertVideos(videos as TikTokVideo[], username, sinceCursor);
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

      rawItems.push({
        url: `https://www.tiktok.com/@${authorHandle}/video/${video.id}`,
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
