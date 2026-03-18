import { BaseConnector } from './base';
import { launchBrowser } from '../browser';
import { FetchResult, RawItem } from '../types';

/**
 * X/Twitter via Cloudflare Browser Rendering (direct x.com scraping).
 *
 * source.url_or_handle  — Twitter username, @handle, or full x.com URL
 *
 * config keys:
 *   include_retweets  — true | false (default: false)
 *   max_results       — max items (default: 20)
 */
export class XBrowserConnector extends BaseConnector {
  /** Extract username from various input formats */
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

    const browser = await launchBrowser(this.env);
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1280, height: 900 });

      return await this.scrapeDirectX(page, username, sinceCursor, includeRetweets);
    } finally {
      await browser.close();
    }
  }

  // ─── Direct x.com scraping ────────────────────────────────────────────────

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

        // Join all span/a children to capture text split across multiple nodes
        const textEl = tweetEl.querySelector('[data-testid="tweetText"]');
        const text = textEl
          ? Array.from(textEl.querySelectorAll('span, a'))
              .map(el => el.textContent ?? '')
              .join('').trim()
          : '';

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

  // ─── Conversion ───────────────────────────────────────────────────────────

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
      // x.com uses ISO datetime strings in <time datetime="..."> elements
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    } catch {
      return null;
    }
  }
}
