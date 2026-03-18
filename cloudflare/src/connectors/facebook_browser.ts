import { BaseConnector } from './base';
import { launchBrowser } from '../browser';
import { FetchResult, RawItem } from '../types';

/**
 * Facebook Page via Cloudflare Browser Rendering.
 *
 * Strategy waterfall (auto):
 *   1. mbasic.facebook.com  — no-JS, fast, works for most public pages without cookies
 *   2. www.facebook.com     — full SPA, requires FB_COOKIES session cookies
 *
 * FB_COOKIES (optional for public pages, required for private/restricted):
 *   JSON array:  [{"name":"c_user","value":"..."},{"name":"xs","value":"..."}]
 *   Cookie str:  "c_user=123; xs=abc; datr=xyz"
 *   Set via:     wrangler secret put FB_COOKIES
 *
 * source.url_or_handle — page slug, numeric ID, or full facebook.com URL
 *
 * config keys:
 *   max_results   — max posts to fetch (default: 10)
 *   lookback_days — ignore posts older than N days (default: 3)
 *   strategy      — "mbasic" | "full" | "auto" (default: "auto")
 */
export class FacebookBrowserConnector extends BaseConnector {

  protected maxResults(): number {
    return (this.config.max_results as number) ?? 10;
  }

  private extractHandle(): string {
    let h = this.source.url_or_handle.trim();
    h = h.replace(/^https?:\/\/(www\.|m\.|mbasic\.)?facebook\.com\//i, '');
    h = h.split('?')[0].replace(/\/$/, '');
    return h;
  }

  /** Parse FB_COOKIES secret into puppeteer CookieParam array */
  private parseCookies(): Array<{ name: string; value: string; domain: string; path: string }> {
    const raw = this.env.FB_COOKIES?.trim();
    if (!raw) return [];

    // Try JSON array format first: [{"name":"c_user","value":"..."},...]
    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw) as Array<{ name: string; value: string; domain?: string; path?: string }>;
        return arr.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain ?? '.facebook.com',
          path: c.path ?? '/',
        }));
      } catch { /* fall through to string parse */ }
    }

    // Cookie string format: "c_user=123; xs=abc; datr=xyz"
    return raw.split(';').flatMap(pair => {
      const [name, ...rest] = pair.trim().split('=');
      const value = rest.join('=').trim();
      if (!name?.trim() || !value) return [];
      return [{ name: name.trim(), value, domain: '.facebook.com', path: '/' }];
    });
  }

  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const handle = this.extractHandle();
    if (!handle) throw new Error('No Facebook page handle in url_or_handle');

    const cookies = this.parseCookies();
    const strategy = (this.config.strategy as string) ?? 'auto';
    const browser = await launchBrowser(this.env);

    try {
      const page = await browser.newPage();

      // Mobile Chrome UA — lighter rendering, closer to what real users send
      await page.setUserAgent(
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36'
      );
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true });

      // Inject session cookies if available (no-op if empty)
      if (cookies.length > 0) await page.setCookie(...cookies);

      if (strategy === 'full') {
        if (cookies.length === 0) throw new Error(
          'strategy="full" requires FB_COOKIES — set via: wrangler secret put FB_COOKIES'
        );
        return await this.scrapeFullSite(page, handle, sinceCursor, cookies.length > 0);
      }

      // auto / mbasic: always try mbasic first (works for public pages without cookies)
      const mbasicResult = await this.tryMbasic(page, handle, sinceCursor, cookies.length > 0);
      if (mbasicResult !== null) return mbasicResult;

      if (strategy === 'mbasic') {
        throw new Error(
          cookies.length === 0
            ? `mbasic returned 0 posts for "${handle}". Page may require login — set FB_COOKIES secret.`
            : `mbasic returned 0 posts for "${handle}". Try strategy="full" in source config.`
        );
      }

      // auto fallback to full site — requires cookies
      if (cookies.length === 0) {
        throw new Error(
          `mbasic.facebook.com returned no posts for "${handle}" without authentication. ` +
          'For private/restricted pages, set FB_COOKIES secret with your session cookies.'
        );
      }

      return await this.scrapeFullSite(page, handle, sinceCursor, true);
    } finally {
      await browser.close();
    }
  }

  // ─── Strategy 1: mbasic.facebook.com ──────────────────────────────────────

  private async tryMbasic(
    page: import('@cloudflare/puppeteer').Page,
    handle: string,
    sinceCursor: string | null,
    hasCookies: boolean,
  ): Promise<FetchResult | null> {
    try {
      const res = await page.goto(`https://mbasic.facebook.com/${handle}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      if (!res || res.status() >= 400) return null;

      const pageState = await page.evaluate(() => ({
        isLoginPage: !!document.querySelector('#login_form, #loginbutton, [name="login"], [data-sigil="m_login_button"]'),
        hasStories: !!document.querySelector('[data-ft]'),
        postCount: document.querySelectorAll('[data-ft]').length,
        title: document.title,
        url: window.location.href,
      }));

      if (pageState.isLoginPage) {
        if (hasCookies) {
          throw new Error(
            `Session cookies rejected by mbasic.facebook.com for "${handle}". ` +
            'Cookies may have expired — re-extract from your browser and update FB_COOKIES.'
          );
        }
        // No cookies + login wall → let caller decide
        console.log(`mbasic: login required for "${handle}" (no cookies)`);
        return null;
      }

      const posts = await page.evaluate((sinceTs: string | null) => {
        const results: Array<{
          text: string; url: string; timestamp: string | null;
          likes: number; comments: number; shares: number;
        }> = [];

        const containers = Array.from(document.querySelectorAll<HTMLElement>('div[data-ft]'));

        for (const el of containers) {
          // Only keep story posts
          try {
            const ft = JSON.parse(el.getAttribute('data-ft') ?? '{}');
            if (!ft.mf_story_key && !ft.content_owner_id_new && !ft.story_attachment_style) continue;
          } catch { continue; }

          const storyBody = el.querySelector('.story_body_container');
          const text = (storyBody?.textContent ?? '').trim();
          if (!text || text.length < 10) continue;

          // Post URL
          const linkEl = el.querySelector<HTMLAnchorElement>(
            'a[href*="/permalink/"], a[href*="/posts/"], a[href*="/story/"]'
          );
          const rawHref = linkEl?.getAttribute('href') ?? '';
          if (!rawHref) continue;
          const postUrl = rawHref.startsWith('http')
            ? rawHref.split('?')[0]
            : `https://www.facebook.com${rawHref.split('?')[0]}`;

          // Timestamp via data-utime attribute on <abbr>
          const abbr = el.querySelector<HTMLElement>('abbr[data-utime]');
          const utime = abbr ? Number(abbr.getAttribute('data-utime')) : null;
          const timestamp = utime && !isNaN(utime) ? new Date(utime * 1000).toISOString() : null;

          if (sinceTs && timestamp && timestamp <= sinceTs) continue;

          // Engagement from footer links
          let likes = 0, comments = 0, shares = 0;
          el.querySelectorAll<HTMLAnchorElement>('footer a').forEach(a => {
            const txt = a.textContent?.trim() ?? '';
            const num = parseInt(txt.replace(/[^\d]/g, ''), 10) || 0;
            const href = a.getAttribute('href') ?? '';
            if (href.includes('reaction') || /^\d+\s*(like|lượt thích)/i.test(txt)) likes = num;
            else if (href.includes('comment') || /comment/i.test(href)) comments = num;
            else if (href.includes('share')) shares = num;
          });

          results.push({ text, url: postUrl, timestamp, likes, comments, shares });
        }

        return results;
      }, sinceCursor);

      if (!posts || posts.length === 0) {
        console.log(`mbasic: 0 posts for "${handle}" (dataFtCount=${pageState.postCount}, title="${pageState.title}")`);
        return null;
      }

      return this.convertPosts(posts, sinceCursor);
    } catch (err) {
      // Re-throw cookie/auth errors — don't silently swallow them
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('cookies') || msg.includes('Cookies') || msg.includes('rejected')) throw err;
      console.log(`mbasic failed for "${handle}": ${msg}`);
      return null;
    }
  }

  // ─── Strategy 2: www.facebook.com (requires cookies) ─────────────────────

  private async scrapeFullSite(
    page: import('@cloudflare/puppeteer').Page,
    handle: string,
    sinceCursor: string | null,
    _hasCookies: boolean,
  ): Promise<FetchResult> {
    await page.goto(`https://www.facebook.com/${handle}`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 3000));

    const pageState = await page.evaluate(() => ({
      isLoginPage: !!document.querySelector('[data-testid="royal_login_form"]') ||
        document.title.toLowerCase().includes('log in') ||
        document.title.toLowerCase().includes('đăng nhập'),
      postCount: document.querySelectorAll('[role="article"]').length,
      title: document.title,
    }));

    if (pageState.isLoginPage) {
      throw new Error(
        `Cookies rejected on www.facebook.com for "${handle}". ` +
        'Cookies may have expired — re-extract from your browser and update FB_COOKIES.'
      );
    }

    if (pageState.postCount === 0) {
      throw new Error(`facebook.com: 0 articles found for "${handle}". Title: "${pageState.title}"`);
    }

    const posts = await page.evaluate((sinceTs: string | null) => {
      const results: Array<{
        text: string; url: string; timestamp: string | null;
        likes: number; comments: number; shares: number;
      }> = [];

      document.querySelectorAll<HTMLElement>('[role="article"]').forEach(el => {
        if ((el.getAttribute('aria-label') ?? '').toLowerCase().includes('sponsored')) return;

        // Try multiple text extraction selectors (FB changes DOM often)
        const textEl = el.querySelector<HTMLElement>(
          '[data-ad-preview="message"], [dir="auto"], [data-testid="post_message"]'
        );
        const text = (textEl?.innerText ?? textEl?.textContent ?? '').trim();
        if (!text || text.length < 10) return;

        let postUrl = '';
        for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]')) {
          const h = a.getAttribute('href') ?? '';
          if (h.includes('/posts/') || h.includes('/permalink/')) {
            postUrl = h.startsWith('http') ? h.split('?')[0] : `https://www.facebook.com${h.split('?')[0]}`;
            break;
          }
        }
        if (!postUrl) return;

        const timeEl = el.querySelector<HTMLElement>('time[datetime]');
        const timestamp = timeEl?.getAttribute('datetime') ?? null;
        if (sinceTs && timestamp && timestamp <= sinceTs) return;

        // Engagement — aria-label on reaction buttons
        const likeBtn = el.querySelector<HTMLElement>('[aria-label*="reaction"], [aria-label*="Like"]');
        const likes = parseInt((likeBtn?.getAttribute('aria-label') ?? '').replace(/[^\d]/g, '') || '0', 10);

        results.push({ text, url: postUrl, timestamp, likes, comments: 0, shares: 0 });
      });

      return results;
    }, sinceCursor);

    if (!posts || posts.length === 0) {
      throw new Error(`facebook.com: extracted 0 posts from ${pageState.postCount} articles for "${handle}"`);
    }

    return this.convertPosts(posts, sinceCursor);
  }

  // ─── Shared conversion ─────────────────────────────────────────────────────

  private convertPosts(
    posts: Array<{
      text: string; url: string; timestamp: string | null;
      likes: number; comments: number; shares: number;
    }>,
    sinceCursor: string | null,
  ): FetchResult {
    const rawItems: RawItem[] = [];
    let latestTimestamp: string | null = null;
    const maxResults = this.maxResults();
    const lookbackDays = (this.config.lookback_days as number) ?? 3;
    const cutoffMs = Date.now() - lookbackDays * 86_400_000;

    for (const post of posts) {
      if (rawItems.length >= maxResults) break;
      if (sinceCursor && post.timestamp && post.timestamp <= sinceCursor) break;
      if (post.timestamp && new Date(post.timestamp).getTime() < cutoffMs) continue;

      if (!latestTimestamp && post.timestamp) latestTimestamp = post.timestamp;

      rawItems.push({
        url: post.url,
        title: null,
        textContent: post.text || null,
        publishTime: post.timestamp,
        contentType: 'post',
        authorName: this.source.name,
        hasMedia: false,
        engagementSnapshot: {
          likes: post.likes,
          comments: post.comments,
          shares: post.shares,
        },
      });
    }

    return { rawItems, newCursor: latestTimestamp ?? sinceCursor };
  }
}
