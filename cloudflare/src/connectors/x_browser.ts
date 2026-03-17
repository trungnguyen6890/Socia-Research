import puppeteer from '@cloudflare/puppeteer';
import { BaseConnector } from './base';
import { FetchResult, RawItem } from '../types';

/**
 * X/Twitter via Cloudflare Browser Rendering.
 *
 * Strategy order:
 *   1. Try Nitter instances (xcancel.com, nitter.poast.org) via headless Chrome
 *   2. Fallback: scrape x.com directly via headless Chrome (uses data-testid selectors)
 *
 * source.url_or_handle  — Twitter username, @handle, or full x.com URL
 *
 * config keys:
 *   nitter_instance   — preferred Nitter base URL (default: "https://xcancel.com")
 *   include_retweets  — true | false (default: false)
 *   max_results       — max items (default: 20)
 *   strategy          — "nitter" | "direct" | "auto" (default: "auto" — tries nitter then direct)
 */
export class XBrowserConnector extends BaseConnector {
  /** Extract username from various formats */
  private extractUsername(): string {
    let handle = this.source.url_or_handle.trim();
    handle = handle.replace(/^https?:\/\/(x\.com|twitter\.com)\//i, '');
    handle = handle.split('/')[0];
    handle = handle.replace(/^@/, '');
    return handle;
  }

  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const username = this.extractUsername();
    if (!username) throw new Error('No Twitter/X username found in url_or_handle');

    const includeRetweets = Boolean(this.config.include_retweets ?? false);
    const strategy = (this.config.strategy as string) ?? 'auto';

    if (strategy === 'nitter') {
      return this.fetchViaNitter(username, sinceCursor, includeRetweets);
    }
    if (strategy === 'direct') {
      return this.fetchDirectX(username, sinceCursor, includeRetweets);
    }

    // auto: try nitter first, fallback to direct x.com
    try {
      return await this.fetchViaNitter(username, sinceCursor, includeRetweets);
    } catch (nitterErr) {
      const nitterMsg = nitterErr instanceof Error ? nitterErr.message : String(nitterErr);
      try {
        return await this.fetchDirectX(username, sinceCursor, includeRetweets);
      } catch (directErr) {
        const directMsg = directErr instanceof Error ? directErr.message : String(directErr);
        throw new Error(`All strategies failed for @${username}. Nitter: ${nitterMsg}. Direct: ${directMsg}`);
      }
    }
  }

  // ─── Strategy 1: Nitter via Browser Rendering ─────────────────────────────

  private static NITTER_INSTANCES = [
    'https://xcancel.com',
    'https://nitter.poast.org',
  ];

  private async fetchViaNitter(
    username: string,
    sinceCursor: string | null,
    includeRetweets: boolean,
  ): Promise<FetchResult> {
    const preferred = ((this.config.nitter_instance as string) ?? '').replace(/\/$/, '');
    const instances = preferred
      ? [preferred, ...XBrowserConnector.NITTER_INSTANCES.filter(i => i !== preferred)]
      : XBrowserConnector.NITTER_INSTANCES;

    let lastError = '';
    for (const inst of instances) {
      try {
        return await this.tryNitterInstance(username, inst, sinceCursor, includeRetweets);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new Error(`All Nitter instances failed: ${lastError}`);
  }

  private async tryNitterInstance(
    username: string,
    instance: string,
    sinceCursor: string | null,
    includeRetweets: boolean,
  ): Promise<FetchResult> {
    const url = `${instance}/${username}`;
    const browser = await puppeteer.launch(this.env.BROWSER);

    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );

      const response = await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });
      if (!response || response.status() >= 400) {
        throw new Error(`${instance} HTTP ${response?.status() ?? 'no response'}`);
      }

      await page.waitForSelector('.timeline-item, .error-panel, .timeline-none', { timeout: 10000 }).catch(() => {});

      const pageInfo = await page.evaluate(() => ({
        errorText: document.querySelector('.error-panel')?.textContent?.trim() ?? '',
        hasError: !!document.querySelector('.error-panel'),
        hasNone: !!document.querySelector('.timeline-none'),
        itemCount: document.querySelectorAll('.timeline-item').length,
        bodySnippet: document.body?.innerText?.slice(0, 300) ?? '',
      }));

      if (pageInfo.hasError) throw new Error(`${instance} error: ${pageInfo.errorText.slice(0, 150)}`);
      if (pageInfo.itemCount === 0) throw new Error(`${instance}: 0 timeline items. Body: ${pageInfo.bodySnippet.slice(0, 150)}`);

      const tweets = await page.evaluate((includeRT: boolean) => {
        const items: Array<{ id: string; text: string; date: string; isRetweet: boolean; replies: number; retweets: number; likes: number }> = [];
        document.querySelectorAll('.timeline-item').forEach((el) => {
          const isRetweet = !!el.querySelector('.retweet-header');
          if (!includeRT && isRetweet) return;
          const href = el.querySelector('.tweet-link')?.getAttribute('href') ?? '';
          const m = href.match(/\/status\/(\d+)/);
          if (!m) return;
          const text = el.querySelector('.tweet-content, .tweet-body .media-body')?.textContent?.trim() ?? '';
          const date = (el.querySelector('.tweet-date a') as HTMLAnchorElement)?.getAttribute('title') ?? '';
          const stats = el.querySelectorAll('.tweet-stat');
          const parseNum = (i: number) => parseInt(stats[i]?.textContent?.replace(/,/g, '').match(/\d+/)?.[0] ?? '0', 10);
          items.push({ id: m[1], text, date, isRetweet, replies: parseNum(0), retweets: parseNum(1), likes: parseNum(2) });
        });
        return items;
      }, includeRetweets);

      return this.convertTweets(tweets, username, sinceCursor);
    } finally {
      await browser.close();
    }
  }

  // ─── Strategy 2: Direct x.com scraping via Browser Rendering ──────────────

  private async fetchDirectX(
    username: string,
    sinceCursor: string | null,
    includeRetweets: boolean,
  ): Promise<FetchResult> {
    const url = `https://x.com/${username}`;
    const browser = await puppeteer.launch(this.env.BROWSER);

    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );
      // Set viewport to look like a real desktop browser
      await page.setViewport({ width: 1280, height: 900 });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for tweets to render (x.com is a React SPA)
      await page.waitForSelector('[data-testid="tweet"], [data-testid="error-detail"]', { timeout: 15000 }).catch(() => {});

      // Small delay for React hydration
      await new Promise(r => setTimeout(r, 2000));

      // Check for login wall or errors
      const pageState = await page.evaluate(() => {
        const tweetCount = document.querySelectorAll('[data-testid="tweet"]').length;
        const hasLoginPrompt = !!document.querySelector('[data-testid="loginButton"]');
        const hasError = !!document.querySelector('[data-testid="error-detail"]');
        const errorText = document.querySelector('[data-testid="error-detail"]')?.textContent ?? '';
        const bodyText = document.body?.innerText?.slice(0, 500) ?? '';
        const title = document.title ?? '';
        return { tweetCount, hasLoginPrompt, hasError, errorText, bodyText, title };
      });

      if (pageState.hasError) {
        throw new Error(`x.com error: ${pageState.errorText.slice(0, 200)}`);
      }
      if (pageState.tweetCount === 0) {
        if (pageState.hasLoginPrompt) {
          throw new Error(`x.com requires login for @${username}. Title: ${pageState.title}`);
        }
        throw new Error(`x.com: 0 tweets found for @${username}. Title: "${pageState.title}". Body: ${pageState.bodyText.slice(0, 200)}`);
      }

      // Extract tweets using data-testid attributes (stable across x.com updates)
      const tweets = await page.evaluate((includeRT: boolean) => {
        const items: Array<{ id: string; text: string; date: string; isRetweet: boolean; replies: number; retweets: number; likes: number }> = [];

        document.querySelectorAll('[data-testid="tweet"]').forEach((tweetEl) => {
          // Check for retweet indicator
          const socialContext = tweetEl.querySelector('[data-testid="socialContext"]');
          const isRetweet = socialContext?.textContent?.toLowerCase().includes('repost') ?? false;
          if (!includeRT && isRetweet) return;

          // Find the tweet link containing /status/ID
          const links = tweetEl.querySelectorAll('a[href*="/status/"]');
          let statusId = '';
          for (const link of links) {
            const href = link.getAttribute('href') ?? '';
            const m = href.match(/\/status\/(\d+)/);
            if (m) { statusId = m[1]; break; }
          }
          if (!statusId) return;

          // Tweet text
          const textEl = tweetEl.querySelector('[data-testid="tweetText"]');
          const text = textEl?.textContent?.trim() ?? '';

          // Timestamp
          const timeEl = tweetEl.querySelector('time');
          const date = timeEl?.getAttribute('datetime') ?? '';

          // Engagement stats via aria-label on group buttons
          let replies = 0, retweets = 0, likes = 0;
          const replyBtn = tweetEl.querySelector('[data-testid="reply"]');
          const retweetBtn = tweetEl.querySelector('[data-testid="retweet"]');
          const likeBtn = tweetEl.querySelector('[data-testid="like"]');

          const parseAriaNum = (el: Element | null): number => {
            const aria = el?.getAttribute('aria-label') ?? '';
            const m = aria.match(/(\d[\d,]*)/);
            return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
          };

          replies = parseAriaNum(replyBtn);
          retweets = parseAriaNum(retweetBtn);
          likes = parseAriaNum(likeBtn);

          items.push({ id: statusId, text, date, isRetweet, replies, retweets, likes });
        });

        return items;
      }, includeRetweets);

      if (tweets.length === 0) {
        throw new Error(`x.com: found ${pageState.tweetCount} tweet elements but failed to extract any valid data`);
      }

      return this.convertTweets(tweets, username, sinceCursor);
    } finally {
      await browser.close();
    }
  }

  // ─── Shared conversion ────────────────────────────────────────────────────

  private convertTweets(
    tweets: Array<{ id: string; text: string; date: string; isRetweet: boolean; replies: number; retweets: number; likes: number }>,
    username: string,
    sinceCursor: string | null,
  ): FetchResult {
    const rawItems: RawItem[] = [];
    let latestId: string | null = null;

    for (const tweet of tweets) {
      if (sinceCursor && tweet.id === sinceCursor) break;
      if (!latestId) latestId = tweet.id;

      rawItems.push({
        url: `https://x.com/${username}/status/${tweet.id}`,
        title: null,
        textContent: tweet.text || null,
        publishTime: this.parseDate(tweet.date),
        engagementSnapshot: {
          replies: tweet.replies,
          retweets: tweet.retweets,
          likes: tweet.likes,
        },
        rawData: { tweetId: tweet.id, isRetweet: tweet.isRetweet, username },
      });

      if (rawItems.length >= this.maxResults()) break;
    }

    return { rawItems, newCursor: latestId ?? sinceCursor };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private parseDate(dateStr: string): string | null {
    if (!dateStr) return null;
    try {
      // x.com uses ISO datetime in <time> elements
      // Nitter uses "Mar 16, 2026 · 5:30 PM UTC"
      const cleaned = dateStr.replace('·', '').replace(/\s+/g, ' ').trim();
      const d = new Date(cleaned);
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    } catch {
      return null;
    }
  }
}
