import { BaseConnector } from './base';
import { launchBrowser } from '../browser';
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

    // All strategies share ONE browser session to avoid CF Browser Rendering rate limits.
    // Opening multiple browsers per source is the primary cause of 429 errors.
    const browser = await launchBrowser(this.env);
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1280, height: 900 });

      if (strategy === 'direct') {
        return await this.scrapeDirectX(page, username, sinceCursor, includeRetweets);
      }

      // auto or nitter: try Nitter instances first, then fallback to x.com
      const nitterResult = await this.tryNitterInstances(page, username, sinceCursor, includeRetweets);
      if (nitterResult !== null) return nitterResult;

      if (strategy === 'nitter') {
        throw new Error('All Nitter instances failed and strategy=nitter (no direct fallback)');
      }

      // Fallback: scrape x.com directly with the same browser session
      return await this.scrapeDirectX(page, username, sinceCursor, includeRetweets);
    } finally {
      await browser.close();
    }
  }

  // ─── Strategy 1: Nitter via Browser Rendering ─────────────────────────────

  private static NITTER_INSTANCES = [
    'https://xcancel.com',
    'https://nitter.poast.org',
  ];

  // ─── Strategy 1: Nitter (returns null if all instances failed, caller falls through) ──

  private async tryNitterInstances(
    page: import('@cloudflare/puppeteer').Page,
    username: string,
    sinceCursor: string | null,
    includeRetweets: boolean,
  ): Promise<FetchResult | null> {
    const preferred = ((this.config.nitter_instance as string) ?? '').replace(/\/$/, '');
    const instances = preferred
      ? [preferred, ...XBrowserConnector.NITTER_INSTANCES.filter(i => i !== preferred)]
      : XBrowserConnector.NITTER_INSTANCES;

    for (const inst of instances) {
      try {
        const response = await page.goto(`${inst}/${username}`, { waitUntil: 'networkidle0', timeout: 25000 });
        if (!response || response.status() >= 400) continue;

        await page.waitForSelector('.timeline-item, .error-panel, .timeline-none', { timeout: 10000 }).catch(() => {});

        const pageInfo = await page.evaluate(() => ({
          hasError: !!document.querySelector('.error-panel'),
          itemCount: document.querySelectorAll('.timeline-item').length,
        }));

        if (pageInfo.hasError || pageInfo.itemCount === 0) continue;

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

        if (tweets.length > 0) return this.convertTweets(tweets, username, sinceCursor);
      } catch {
        // Continue to next instance
      }
    }
    return null; // All instances failed — caller will try direct x.com
  }

  // ─── Strategy 2: Direct x.com scraping ────────────────────────────────────

  private async scrapeDirectX(
    page: import('@cloudflare/puppeteer').Page,
    username: string,
    sinceCursor: string | null,
    includeRetweets: boolean,
  ): Promise<FetchResult> {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2', timeout: 30000 });

    await page.waitForSelector('[data-testid="tweet"], [data-testid="error-detail"]', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const pageState = await page.evaluate(() => ({
      tweetCount: document.querySelectorAll('[data-testid="tweet"]').length,
      hasLoginPrompt: !!document.querySelector('[data-testid="loginButton"]'),
      hasError: !!document.querySelector('[data-testid="error-detail"]'),
      errorText: document.querySelector('[data-testid="error-detail"]')?.textContent?.slice(0, 200) ?? '',
      title: document.title ?? '',
    }));

    if (pageState.hasError) throw new Error(`x.com error: ${pageState.errorText}`);
    if (pageState.tweetCount === 0) {
      const reason = pageState.hasLoginPrompt ? 'login required' : `0 tweets. Title: "${pageState.title}"`;
      throw new Error(`x.com: ${reason} for @${username}`);
    }

    const tweets = await page.evaluate((includeRT: boolean) => {
      const items: Array<{ id: string; text: string; date: string; isRetweet: boolean; replies: number; retweets: number; likes: number }> = [];
      document.querySelectorAll('[data-testid="tweet"]').forEach((tweetEl) => {
        const isRetweet = tweetEl.querySelector('[data-testid="socialContext"]')?.textContent?.toLowerCase().includes('repost') ?? false;
        if (!includeRT && isRetweet) return;
        let statusId = '';
        for (const link of tweetEl.querySelectorAll('a[href*="/status/"]')) {
          const m = link.getAttribute('href')?.match(/\/status\/(\d+)/);
          if (m) { statusId = m[1]; break; }
        }
        if (!statusId) return;
        const text = tweetEl.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? '';
        const date = tweetEl.querySelector('time')?.getAttribute('datetime') ?? '';
        const parseAriaNum = (el: Element | null) => {
          const m = (el?.getAttribute('aria-label') ?? '').match(/(\d[\d,]*)/);
          return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
        };
        items.push({
          id: statusId, text, date, isRetweet,
          replies: parseAriaNum(tweetEl.querySelector('[data-testid="reply"]')),
          retweets: parseAriaNum(tweetEl.querySelector('[data-testid="retweet"]')),
          likes: parseAriaNum(tweetEl.querySelector('[data-testid="like"]')),
        });
      });
      return items;
    }, includeRetweets);

    if (tweets.length === 0) throw new Error(`x.com: ${pageState.tweetCount} tweet elements found but no valid data extracted`);
    return this.convertTweets(tweets, username, sinceCursor);
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
        contentType: 'tweet',
        authorName: username,
        hasMedia: false,
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
