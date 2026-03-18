import { BaseConnector } from './base';
import { launchBrowser } from '../browser';
import { FetchResult, RawItem } from '../types';

/**
 * Facebook Page via Cloudflare Browser Rendering.
 *
 * Strategy waterfall:
 *   1. mbasic.facebook.com WITHOUT cookies — works for public pages, no IP/session issues
 *   2. mbasic.facebook.com WITH cookies    — for pages that need auth
 *   3. www.facebook.com WITH cookies       — full SPA fallback
 *
 * Note: Facebook binds sessions to IP. Cookies extracted from a home browser
 * will be rejected when used from a Cloudflare datacenter. Prefer strategy "mbasic"
 * which works for public pages without any cookies.
 *
 * FB_COOKIES (optional — only needed for private/restricted pages):
 *   JSON: [{"name":"c_user","value":"..."},{"name":"xs","value":"..."}]
 *   Set:  wrangler secret put FB_COOKIES
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
    const decode = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw) as Array<{ name: string; value: string; domain?: string; path?: string }>;
        return arr.map(c => ({ name: c.name, value: decode(c.value), domain: c.domain ?? '.facebook.com', path: c.path ?? '/' }));
      } catch { /* fall through */ }
    }
    return raw.split(';').flatMap(pair => {
      const [name, ...rest] = pair.trim().split('=');
      const value = rest.join('=').trim();
      if (!name?.trim() || !value) return [];
      return [{ name: name.trim(), value: decode(value), domain: '.facebook.com', path: '/' }];
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

      if (strategy === 'full') {
        if (cookies.length === 0) throw new Error('strategy="full" requires FB_COOKIES');
        await page.setCookie(...cookies);
        return await this.scrapeFullSite(page, handle, sinceCursor);
      }

      // ── Step 1: mbasic WITHOUT cookies (best for public pages, avoids IP rejection) ──
      const mbasicPublic = await this.tryMbasic(page, handle, sinceCursor, false);
      if (mbasicPublic !== null) return mbasicPublic;

      if (strategy === 'mbasic' && cookies.length === 0) {
        throw new Error(
          `mbasic.facebook.com returned 0 posts for "${handle}" without authentication. ` +
          'The page may be restricted — set FB_COOKIES or verify the page is public.'
        );
      }

      // ── Step 2: mbasic WITH cookies ───────────────────────────────────────────────
      if (cookies.length > 0) {
        await page.setCookie(...cookies);
        const mbasicAuth = await this.tryMbasic(page, handle, sinceCursor, true);
        if (mbasicAuth !== null) return mbasicAuth;
      }

      if (strategy === 'mbasic') {
        throw new Error(`mbasic returned 0 posts for "${handle}". Try strategy="full".`);
      }

      // ── Step 3: full www.facebook.com (cookies required) ─────────────────────────
      if (cookies.length === 0) {
        throw new Error(
          `Could not fetch posts for "${handle}" without authentication. ` +
          'Set FB_COOKIES secret or ensure the page is public on mbasic.facebook.com.'
        );
      }

      return await this.scrapeFullSite(page, handle, sinceCursor);
    } finally {
      await browser.close();
    }
  }

  // ─── Strategy 1: mbasic.facebook.com ──────────────────────────────────────

  private async tryMbasic(
    page: import('@cloudflare/puppeteer').Page,
    handle: string,
    sinceCursor: string | null,
    withCookies: boolean,
  ): Promise<FetchResult | null> {
    try {
      const res = await page.goto(`https://mbasic.facebook.com/${handle}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      if (!res || res.status() >= 400) {
        console.log(`mbasic "${handle}": HTTP ${res?.status()}`);
        return null;
      }

      const pageState = await page.evaluate(() => ({
        isLoginPage: !!document.querySelector('#login_form, #loginbutton, [name="login"], [data-sigil="m_login_button"]'),
        titleIsLogin: /log in|đăng nhập/i.test(document.title),
        dataFtCount: document.querySelectorAll('[data-ft]').length,
        articleCount: document.querySelectorAll('article').length,
        storyCount: document.querySelectorAll('._5pcr, .userContentWrapper, [data-story-id]').length,
        title: document.title,
        url: window.location.href,
        bodyLen: document.body.innerHTML.length,
      }));

      const isLogin = pageState.isLoginPage || pageState.titleIsLogin;
      console.log(`mbasic "${handle}" [cookies=${withCookies}]: login=${isLogin}, data-ft=${pageState.dataFtCount}, article=${pageState.articleCount}, story=${pageState.storyCount}, title="${pageState.title}", url=${pageState.url}, bodyLen=${pageState.bodyLen}`);

      if (isLogin) {
        if (withCookies) throw new Error(
          `Session cookies rejected by mbasic.facebook.com for "${handle}" — ` +
          'Facebook binds sessions to IP. Cookies from your home browser cannot be used from a cloud server.'
        );
        return null;
      }

      // Extract posts from mbasic HTML
      const posts = await page.evaluate((sinceTs: string | null) => {
        const results: Array<{
          text: string; url: string; timestamp: string | null;
          likes: number; comments: number; shares: number;
        }> = [];

        // Try selectors from most to least specific
        let containers: HTMLElement[] = [];

        // 1. Standard mbasic posts with data-ft (story key)
        containers = Array.from(document.querySelectorAll<HTMLElement>('div[data-ft]')).filter(el => {
          try { const ft = JSON.parse(el.getAttribute('data-ft') ?? '{}'); return !!(ft.mf_story_key || ft.content_owner_id_new); } catch { return false; }
        });

        // 2. Any div with data-ft (less strict)
        if (containers.length === 0) {
          containers = Array.from(document.querySelectorAll<HTMLElement>('div[data-ft]'));
        }

        // 3. article elements
        if (containers.length === 0) {
          containers = Array.from(document.querySelectorAll<HTMLElement>('article'));
        }

        // 4. Divs containing story links
        if (containers.length === 0) {
          containers = Array.from(document.querySelectorAll<HTMLElement>('div')).filter(el =>
            el.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/story/"]') &&
            (el.textContent ?? '').trim().length > 20 &&
            el.children.length > 1
          ).slice(0, 20);
        }

        for (const el of containers) {
          const bodyEl = el.querySelector('.story_body_container, ._5pbx, [data-testid="post_message"]') ?? el;
          const text = (bodyEl.textContent ?? '').trim();
          if (!text || text.length < 10) continue;

          const linkEl = el.querySelector<HTMLAnchorElement>(
            'a[href*="/posts/"], a[href*="/permalink/"], a[href*="/story/"]'
          );
          const rawHref = linkEl?.getAttribute('href') ?? '';
          if (!rawHref) continue;

          const postUrl = rawHref.startsWith('http')
            ? rawHref.split('?')[0]
            : `https://www.facebook.com${rawHref.split('?')[0]}`;

          const abbr = el.querySelector<HTMLElement>('abbr[data-utime]');
          const utime = abbr ? Number(abbr.getAttribute('data-utime')) : null;
          const timestamp = utime && !isNaN(utime) ? new Date(utime * 1000).toISOString() : null;
          if (sinceTs && timestamp && timestamp <= sinceTs) continue;

          let likes = 0, comments = 0, shares = 0;
          el.querySelectorAll<HTMLAnchorElement>('footer a, ._4bl9 a').forEach(a => {
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

      console.log(`mbasic "${handle}": extracted ${posts?.length ?? 0} posts`);
      if (!posts || posts.length === 0) return null;

      return this.convertPosts(posts, sinceCursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('cookies') || msg.includes('rejected') || msg.includes('IP')) throw err;
      console.log(`mbasic failed for "${handle}": ${msg}`);
      return null;
    }
  }

  // ─── Strategy 2: www.facebook.com ─────────────────────────────────────────

  private async scrapeFullSite(
    page: import('@cloudflare/puppeteer').Page,
    handle: string,
    sinceCursor: string | null,
  ): Promise<FetchResult> {
    await page.goto(`https://www.facebook.com/${handle}`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Dismiss modals
    await page.evaluate(() => {
      ['[aria-label="Close"]', '[aria-label="Đóng"]', 'button[title="Allow all cookies"]'].forEach(sel => {
        (document.querySelector(sel) as HTMLElement | null)?.click();
      });
    });
    await new Promise(r => setTimeout(r, 1500));

    await page.waitForSelector('[role="article"], [data-pagelet*="FeedUnit"]', { timeout: 12000 })
      .catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 2000));

    const pageState = await page.evaluate(() => {
      const titleLower = document.title.toLowerCase();
      return {
        isLoginPage:
          !!document.querySelector('[data-testid="royal_login_form"]') ||
          titleLower === 'log in to facebook | facebook' ||
          titleLower === 'đăng nhập facebook | facebook',
        articleCount: document.querySelectorAll('[role="article"]').length,
        title: document.title,
        url: window.location.href,
      };
    });

    console.log(`full site "${handle}": login=${pageState.isLoginPage}, articles=${pageState.articleCount}, title="${pageState.title}", url=${pageState.url}`);

    if (pageState.isLoginPage) {
      throw new Error(
        `Facebook full site rejected session for "${handle}" (title="${pageState.title}"). ` +
        'Facebook binds sessions to IP — cookies from home browser cannot be used from a cloud server. ' +
        'Use strategy="mbasic" for public pages instead.'
      );
    }

    if (pageState.articleCount === 0) {
      throw new Error(`facebook.com: 0 articles for "${handle}" (title="${pageState.title}", url=${pageState.url})`);
    }

    const posts = await page.evaluate((sinceTs: string | null) => {
      const results: Array<{ text: string; url: string; timestamp: string | null; likes: number; comments: number; shares: number }> = [];
      document.querySelectorAll<HTMLElement>('[role="article"]').forEach(el => {
        if (/sponsored|tài trợ/i.test(el.getAttribute('aria-label') ?? '')) return;
        const textEl = [
          '[data-ad-preview="message"]', '[dir="auto"]', '[data-testid="post_message"]'
        ].map(s => el.querySelector<HTMLElement>(s)).find(e => e && (e.innerText ?? '').trim().length > 10);
        const text = (textEl?.innerText ?? textEl?.textContent ?? '').trim();
        if (!text) return;
        let postUrl = '';
        for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]')) {
          const h = a.getAttribute('href') ?? '';
          if (h.includes('/posts/') || h.includes('/permalink/')) {
            postUrl = h.startsWith('http') ? h.split('?')[0] : `https://www.facebook.com${h.split('?')[0]}`;
            break;
          }
        }
        if (!postUrl) return;
        const timestamp = el.querySelector<HTMLElement>('time[datetime]')?.getAttribute('datetime') ?? null;
        if (sinceTs && timestamp && timestamp <= sinceTs) return;
        results.push({ text, url: postUrl, timestamp, likes: 0, comments: 0, shares: 0 });
      });
      return results;
    }, sinceCursor);

    if (!posts?.length) throw new Error(`facebook.com: extracted 0 posts from ${pageState.articleCount} articles for "${handle}"`);
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
