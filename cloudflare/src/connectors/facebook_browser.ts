import { BaseConnector } from './base';
import { launchBrowser } from '../browser';
import { FetchResult, RawItem } from '../types';

/**
 * Facebook Page via Cloudflare Browser Rendering.
 *
 * Strategy waterfall (auto):
 *   1. mbasic.facebook.com  — lightweight HTML, public pages often work without cookies
 *   2. www.facebook.com     — SPA, requires FB_COOKIES session cookies
 *
 * FB_COOKIES (optional for public pages):
 *   JSON array:  [{"name":"c_user","value":"..."},{"name":"xs","value":"..."}]
 *   Set via:     wrangler secret put FB_COOKIES
 *
 * config keys:
 *   max_results   — max posts (default: 10)
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

  private parseCookies(): Array<{ name: string; value: string; domain: string; path: string }> {
    const raw = this.env.FB_COOKIES?.trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw) as Array<{ name: string; value: string; domain?: string; path?: string }>;
        return arr.map(c => ({ name: c.name, value: c.value, domain: c.domain ?? '.facebook.com', path: c.path ?? '/' }));
      } catch { /* fall through */ }
    }
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
      await page.setUserAgent(
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36'
      );
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true });
      if (cookies.length > 0) await page.setCookie(...cookies);

      if (strategy === 'full') {
        if (cookies.length === 0) throw new Error('strategy="full" requires FB_COOKIES');
        return await this.scrapeFullSite(page, handle, sinceCursor, !!cookies.length);
      }

      // auto / mbasic: try mbasic first
      const mbasicResult = await this.tryMbasic(page, handle, sinceCursor, !!cookies.length);
      if (mbasicResult !== null) return mbasicResult;

      if (strategy === 'mbasic') {
        throw new Error(
          `mbasic returned 0 posts for "${handle}". ` +
          (cookies.length === 0 ? 'Set FB_COOKIES or try strategy="full".' : 'Try strategy="full".')
        );
      }

      if (cookies.length === 0) {
        throw new Error(
          `mbasic.facebook.com returned no posts for "${handle}" without authentication. ` +
          'Set FB_COOKIES secret with your session cookies.'
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
        dataFtCount: document.querySelectorAll('[data-ft]').length,
        articleCount: document.querySelectorAll('article').length,
        title: document.title,
        bodySnippet: document.body.innerHTML.slice(0, 500),
      }));

      console.log(`mbasic "${handle}": login=${pageState.isLoginPage}, data-ft=${pageState.dataFtCount}, article=${pageState.articleCount}, title="${pageState.title}"`);

      if (pageState.isLoginPage) {
        if (hasCookies) throw new Error(
          `Session cookies rejected by mbasic.facebook.com for "${handle}". ` +
          'Cookies may have expired — re-extract and update FB_COOKIES.'
        );
        console.log(`mbasic: login wall without cookies for "${handle}"`);
        return null;
      }

      const posts = await page.evaluate((sinceTs: string | null) => {
        const results: Array<{
          text: string; url: string; timestamp: string | null;
          likes: number; comments: number; shares: number;
        }> = [];

        // Primary: data-ft containers (standard mbasic posts)
        let containers = Array.from(document.querySelectorAll<HTMLElement>('div[data-ft]'));

        // Fallback: article elements
        if (containers.length === 0) {
          containers = Array.from(document.querySelectorAll<HTMLElement>('article'));
        }

        // Fallback 2: divs with story links
        if (containers.length === 0) {
          containers = Array.from(document.querySelectorAll<HTMLElement>(
            'div:has(a[href*="/posts/"]), div:has(a[href*="/permalink/"])'
          ));
        }

        for (const el of containers) {
          // Filter: must be a story post (data-ft check)
          if (el.hasAttribute('data-ft')) {
            try {
              const ft = JSON.parse(el.getAttribute('data-ft') ?? '{}');
              if (!ft.mf_story_key && !ft.content_owner_id_new && !ft.story_attachment_style) continue;
            } catch { continue; }
          }

          // Extract text from story body or full element
          const bodyEl = el.querySelector('.story_body_container') ?? el;
          const text = (bodyEl.textContent ?? '').trim();
          if (!text || text.length < 10) continue;

          // Post URL: prefer permalink > posts > story
          const linkEl = el.querySelector<HTMLAnchorElement>(
            'a[href*="/permalink/"], a[href*="/posts/"], a[href*="/story/"]'
          );
          const rawHref = linkEl?.getAttribute('href') ?? '';
          if (!rawHref) continue;
          const postUrl = rawHref.startsWith('http')
            ? rawHref.split('?')[0]
            : `https://www.facebook.com${rawHref.split('?')[0]}`;

          // Timestamp
          const abbr = el.querySelector<HTMLElement>('abbr[data-utime]');
          const utime = abbr ? Number(abbr.getAttribute('data-utime')) : null;
          const timestamp = utime && !isNaN(utime) ? new Date(utime * 1000).toISOString() : null;
          if (sinceTs && timestamp && timestamp <= sinceTs) continue;

          // Engagement
          let likes = 0, comments = 0, shares = 0;
          el.querySelectorAll<HTMLAnchorElement>('footer a').forEach(a => {
            const txt = a.textContent?.trim() ?? '';
            const num = parseInt(txt.replace(/[^\d]/g, ''), 10) || 0;
            const href = a.getAttribute('href') ?? '';
            if (href.includes('reaction') || /lượt thích|like/i.test(txt)) likes = num;
            else if (href.includes('comment')) comments = num;
            else if (href.includes('share')) shares = num;
          });

          results.push({ text, url: postUrl, timestamp, likes, comments, shares });
        }

        return results;
      }, sinceCursor);

      if (!posts || posts.length === 0) {
        console.log(`mbasic: 0 valid posts extracted for "${handle}"`);
        return null;
      }

      return this.convertPosts(posts, sinceCursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('cookies') || msg.includes('rejected')) throw err;
      console.log(`mbasic failed for "${handle}": ${msg}`);
      return null;
    }
  }

  // ─── Strategy 2: www.facebook.com ─────────────────────────────────────────

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

    // Dismiss any modal dialogs (cookie consent, login prompt overlays)
    await page.evaluate(() => {
      const selectors = [
        '[aria-label="Close"]', '[aria-label="Đóng"]',
        '[data-testid="cookie-policy-manage-dialog-accept-button"]',
        'button[title="Allow all cookies"]',
      ];
      for (const sel of selectors) {
        (document.querySelector(sel) as HTMLElement | null)?.click();
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    // Wait for articles to render (lazy loaded)
    await page.waitForSelector('[role="article"], [data-pagelet*="FeedUnit"]', { timeout: 12000 })
      .catch(() => console.log(`full site: waitForSelector timeout for "${handle}"`));

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 2000));

    const pageState = await page.evaluate(() => ({
      isLoginPage:
        !!document.querySelector('[data-testid="royal_login_form"]') ||
        document.title.toLowerCase().includes('log in') ||
        document.title.toLowerCase().includes('đăng nhập') ||
        !!document.querySelector('form[action*="login"]'),
      articleCount: document.querySelectorAll('[role="article"]').length,
      feedUnitCount: document.querySelectorAll('[data-pagelet*="FeedUnit"]').length,
      title: document.title,
    }));

    console.log(`full site "${handle}": login=${pageState.isLoginPage}, articles=${pageState.articleCount}, feedUnits=${pageState.feedUnitCount}, title="${pageState.title}"`);

    if (pageState.isLoginPage) {
      throw new Error(
        `Cookies rejected on www.facebook.com for "${handle}". ` +
        'Re-extract cookies from your browser and run: wrangler secret put FB_COOKIES'
      );
    }

    const totalFound = pageState.articleCount + pageState.feedUnitCount;
    if (totalFound === 0) {
      throw new Error(
        `facebook.com: 0 posts found for "${handle}" (title="${pageState.title}"). ` +
        'Page may require login or uses unsupported layout — set FB_COOKIES or try strategy="mbasic".'
      );
    }

    const posts = await page.evaluate((sinceTs: string | null) => {
      const results: Array<{
        text: string; url: string; timestamp: string | null;
        likes: number; comments: number; shares: number;
      }> = [];

      // Try article[role="article"] first, then data-pagelet feed units
      const articleEls = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="article"], [data-pagelet*="FeedUnit"]'
      ));

      for (const el of articleEls) {
        // Skip sponsored
        const ariaLabel = el.getAttribute('aria-label') ?? '';
        if (/sponsored|tài trợ/i.test(ariaLabel)) continue;

        // Text extraction — try multiple selectors (FB changes DOM often)
        const textCandidates = [
          el.querySelector<HTMLElement>('[data-ad-preview="message"]'),
          el.querySelector<HTMLElement>('[data-testid="post_message"]'),
          el.querySelector<HTMLElement>('[dir="auto"]'),
          el.querySelector<HTMLElement>('[class*="userContent"]'),
        ];
        const textEl = textCandidates.find(e => e && (e.innerText ?? e.textContent ?? '').trim().length > 10);
        const text = (textEl?.innerText ?? textEl?.textContent ?? '').trim();
        if (!text || text.length < 10) continue;

        // Post URL
        let postUrl = '';
        for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]')) {
          const h = a.getAttribute('href') ?? '';
          if (h.includes('/posts/') || h.includes('/permalink/') || h.includes('/story/')) {
            postUrl = h.startsWith('http') ? h.split('?')[0] : `https://www.facebook.com${h.split('?')[0]}`;
            break;
          }
        }
        if (!postUrl) continue;

        // Timestamp
        const timeEl = el.querySelector<HTMLElement>('time[datetime]');
        const timestamp = timeEl?.getAttribute('datetime') ?? null;
        if (sinceTs && timestamp && timestamp <= sinceTs) continue;

        results.push({ text, url: postUrl, timestamp, likes: 0, comments: 0, shares: 0 });
      }

      return results;
    }, sinceCursor);

    if (!posts || posts.length === 0) {
      throw new Error(
        `facebook.com: found ${totalFound} post containers for "${handle}" but could not extract text/URL. ` +
        'FB may have changed its DOM structure.'
      );
    }

    return this.convertPosts(posts, sinceCursor);
  }

  // ─── Shared conversion ─────────────────────────────────────────────────────

  private convertPosts(
    posts: Array<{ text: string; url: string; timestamp: string | null; likes: number; comments: number; shares: number }>,
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
        engagementSnapshot: { likes: post.likes, comments: post.comments, shares: post.shares },
      });
    }

    return { rawItems, newCursor: latestTimestamp ?? sinceCursor };
  }
}
