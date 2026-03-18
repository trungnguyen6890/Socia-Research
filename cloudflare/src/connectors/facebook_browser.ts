import { BaseConnector } from './base';
import { launchBrowser } from '../browser';
import { FetchResult, RawItem } from '../types';

/**
 * Facebook Page via Cloudflare Browser Rendering → mbasic.facebook.com.
 *
 * Uses mbasic (lightweight HTML, no JS rendering) for reliable scraping.
 * Facebook binds sessions to IP — cookies from a home browser are rejected
 * from Cloudflare datacenter IPs. We try without cookies first (public pages),
 * then with cookies if available.
 *
 * strategy="full" forces www.facebook.com (requires FB_COOKIES + same-IP session).
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

    // ── strategy="full": only use www.facebook.com ──────────────────────────
    if (strategy === 'full') {
      if (cookies.length === 0) throw new Error('strategy="full" requires FB_COOKIES');
      const browser = await launchBrowser(this.env);
      try {
        const page = await browser.newPage();
        await this.setupPage(page);
        await page.setCookie(...cookies);
        return await this.scrapeFullSite(page, handle, sinceCursor);
      } finally {
        await browser.close();
      }
    }

    // ── auto / mbasic: try mbasic, parse raw HTML ────────────────────────────
    const browser = await launchBrowser(this.env);
    try {
      const page = await browser.newPage();
      await this.setupPage(page);

      // Attempt 1: no cookies (best for public pages — no IP session rejection)
      const result1 = await this.scrapeMbasic(page, handle, sinceCursor, false);
      if (result1.posts !== null) return this.convertPosts(result1.posts, sinceCursor);

      console.log(`mbasic no-auth: ${result1.reason} | data-ft=${result1.dataFtCount} body=${result1.bodyLen} title="${result1.title}"`);

      if (strategy === 'mbasic' && cookies.length === 0) {
        throw new Error(
          `mbasic returned 0 posts for "${handle}" without authentication ` +
          `(${result1.reason}, title="${result1.title}"). ` +
          'Page may require login. Set FB_COOKIES or check page visibility.'
        );
      }

      // Attempt 2: with cookies (page might need auth)
      if (cookies.length > 0) {
        await page.setCookie(...cookies);
        const result2 = await this.scrapeMbasic(page, handle, sinceCursor, true);
        if (result2.posts !== null) return this.convertPosts(result2.posts, sinceCursor);
        console.log(`mbasic with-auth: ${result2.reason} | data-ft=${result2.dataFtCount} body=${result2.bodyLen} title="${result2.title}"`);

        throw new Error(
          `mbasic.facebook.com could not fetch "${handle}" with cookies either ` +
          `(${result2.reason}, title="${result2.title}"). ` +
          'Facebook likely rejects cookies from cloud server IPs. ' +
          'Consider using the facebook_page connector with a Graph API token instead.'
        );
      }

      throw new Error(
        `mbasic.facebook.com returned 0 posts for "${handle}" ` +
        `(${result1.reason}, title="${result1.title}"). ` +
        'The page may require login — set FB_COOKIES or try facebook_page connector.'
      );
    } finally {
      await browser.close();
    }
  }

  // ─── Page setup ───────────────────────────────────────────────────────────

  private async setupPage(page: import('@cloudflare/puppeteer').Page): Promise<void> {
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36'
    );
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true });
  }

  // ─── mbasic scraper ───────────────────────────────────────────────────────

  private async scrapeMbasic(
    page: import('@cloudflare/puppeteer').Page,
    handle: string,
    sinceCursor: string | null,
    withCookies: boolean,
  ): Promise<{
    posts: Array<{ text: string; url: string; timestamp: string | null; likes: number; comments: number; shares: number }> | null;
    reason: string;
    dataFtCount: number;
    bodyLen: number;
    title: string;
  }> {
    const nullResult = (reason: string, dataFtCount = 0, bodyLen = 0, title = '') =>
      ({ posts: null, reason, dataFtCount, bodyLen, title });

    try {
      const res = await page.goto(`https://mbasic.facebook.com/${handle}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });

      if (!res || res.status() >= 400) {
        return nullResult(`HTTP ${res?.status() ?? 'no-response'}`);
      }

      // Get raw HTML — more reliable than evaluate() for structure inspection
      const html = await page.content();
      const bodyLen = html.length;
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/&amp;/g, '&').trim() : '';

      const isLoginPage =
        /id="login_form"/i.test(html) ||
        /name="login"/i.test(html) ||
        /data-sigil="m_login_button"/i.test(html) ||
        /log in to facebook/i.test(title) ||
        /đăng nhập vào facebook/i.test(title);

      if (isLoginPage) {
        if (withCookies) {
          throw new Error(
            `mbasic rejected cookies for "${handle}" (title="${title}") — ` +
            'Facebook IP session binding prevents cloud server cookie auth.'
          );
        }
        return nullResult('login-wall', 0, bodyLen, title);
      }

      // Count data-ft containers in raw HTML
      const dataFtCount = (html.match(/data-ft="/g) ?? []).length;
      const postLinkCount = (html.match(/href="[^"]*\/posts\/[^"]*"/g) ?? []).length +
        (html.match(/href="[^"]*\/permalink\/[^"]*"/g) ?? []).length;

      console.log(`mbasic "${handle}" [auth=${withCookies}]: title="${title}", bodyLen=${bodyLen}, data-ft=${dataFtCount}, postLinks=${postLinkCount}`);

      // Parse posts from HTML via page.evaluate (DOM available after goto)
      const posts = await page.evaluate((sinceTs: string | null) => {
        const results: Array<{
          text: string; url: string; timestamp: string | null;
          likes: number; comments: number; shares: number;
        }> = [];

        // Collect all post containers across multiple selector strategies
        const seen = new Set<string>();

        const tryContainers = (els: HTMLElement[]) => {
          for (const el of els) {
            // Find a story/permalink link
            const linkEl = el.querySelector<HTMLAnchorElement>(
              'a[href*="/posts/"], a[href*="/permalink/"], a[href*="/story/"]'
            );
            const rawHref = linkEl?.getAttribute('href') ?? '';
            if (!rawHref) continue;
            const postUrl = rawHref.startsWith('http')
              ? rawHref.split('?')[0]
              : `https://www.facebook.com${rawHref.split('?')[0]}`;
            if (seen.has(postUrl)) continue;

            // Text: prefer story body container, fall back to el text
            const bodyEl = el.querySelector('.story_body_container, ._5pbx') ?? el;
            // Exclude nav/footer noise by capping at 2000 chars
            const text = (bodyEl.textContent ?? '').trim().slice(0, 2000);
            if (!text || text.length < 15) continue;

            // Timestamp
            const abbr = el.querySelector<HTMLElement>('abbr[data-utime]');
            const utime = abbr ? Number(abbr.getAttribute('data-utime')) : null;
            const timestamp = utime && !isNaN(utime) ? new Date(utime * 1000).toISOString() : null;
            if (sinceTs && timestamp && timestamp <= sinceTs) continue;

            // Engagement
            let likes = 0, comments = 0, shares = 0;
            el.querySelectorAll<HTMLAnchorElement>('footer a, ._4bl9 a').forEach(a => {
              const txt = a.textContent?.trim() ?? '';
              const num = parseInt(txt.replace(/[^\d]/g, ''), 10) || 0;
              const href = a.getAttribute('href') ?? '';
              if (href.includes('reaction') || /lượt thích|like/i.test(txt)) likes = num;
              else if (href.includes('comment')) comments = num;
              else if (href.includes('share')) shares = num;
            });

            seen.add(postUrl);
            results.push({ text, url: postUrl, timestamp, likes, comments, shares });
          }
        };

        // Strategy 1: data-ft with mf_story_key
        tryContainers(
          Array.from(document.querySelectorAll<HTMLElement>('div[data-ft]')).filter(el => {
            try { const ft = JSON.parse(el.getAttribute('data-ft') ?? '{}'); return !!(ft.mf_story_key || ft.content_owner_id_new); }
            catch { return false; }
          })
        );

        // Strategy 2: any div with data-ft
        if (results.length === 0) {
          tryContainers(Array.from(document.querySelectorAll<HTMLElement>('div[data-ft]')));
        }

        // Strategy 3: article elements
        if (results.length === 0) {
          tryContainers(Array.from(document.querySelectorAll<HTMLElement>('article')));
        }

        // Strategy 4: any block containing a story link + meaningful text
        if (results.length === 0) {
          tryContainers(
            Array.from(document.querySelectorAll<HTMLElement>('div, section')).filter(el =>
              el.querySelector('a[href*="/posts/"], a[href*="/permalink/"]') &&
              (el.textContent ?? '').trim().length > 30 &&
              el.children.length >= 2 &&
              !el.querySelector('[data-ft]') // avoid double-counting
            )
          );
        }

        return results;
      }, sinceCursor);

      if (!posts || posts.length === 0) {
        return nullResult(
          `0 posts extracted (dataFt=${dataFtCount}, postLinks=${postLinkCount})`,
          dataFtCount, bodyLen, title
        );
      }

      return { posts, reason: 'ok', dataFtCount, bodyLen, title };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Re-throw auth/IP errors — don't convert them to null
      if (msg.includes('cookies') || msg.includes('rejected') || msg.includes('IP')) throw err;
      return nullResult(`error: ${msg.slice(0, 100)}`);
    }
  }

  // ─── www.facebook.com (strategy="full" only) ──────────────────────────────

  private async scrapeFullSite(
    page: import('@cloudflare/puppeteer').Page,
    handle: string,
    sinceCursor: string | null,
  ): Promise<FetchResult> {
    await page.goto(`https://www.facebook.com/${handle}`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    await page.evaluate(() => {
      ['[aria-label="Close"]', '[aria-label="Đóng"]', 'button[title="Allow all cookies"]'].forEach(sel => {
        (document.querySelector(sel) as HTMLElement | null)?.click();
      });
    });
    await new Promise(r => setTimeout(r, 1500));
    await page.waitForSelector('[role="article"]', { timeout: 12000 }).catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 2000));

    const state = await page.evaluate(() => ({
      isLogin: document.title.toLowerCase() === 'log in to facebook | facebook' ||
        !!document.querySelector('[data-testid="royal_login_form"]'),
      articleCount: document.querySelectorAll('[role="article"]').length,
      title: document.title,
      url: window.location.href,
    }));

    console.log(`full-site "${handle}": login=${state.isLogin}, articles=${state.articleCount}, title="${state.title}"`);

    if (state.isLogin) throw new Error(
      `Full site rejected session for "${handle}" (title="${state.title}"). ` +
      'Facebook binds sessions to IP — cloud server IPs are blocked.'
    );

    if (state.articleCount === 0) throw new Error(
      `full-site: 0 articles for "${handle}" (title="${state.title}", url=${state.url})`
    );

    const posts = await page.evaluate((sinceTs: string | null) => {
      const results: Array<{ text: string; url: string; timestamp: string | null; likes: number; comments: number; shares: number }> = [];
      document.querySelectorAll<HTMLElement>('[role="article"]').forEach(el => {
        if (/sponsored|tài trợ/i.test(el.getAttribute('aria-label') ?? '')) return;
        const textEl = ['[data-ad-preview="message"]', '[dir="auto"]', '[data-testid="post_message"]']
          .map(s => el.querySelector<HTMLElement>(s)).find(e => e && (e.innerText ?? '').trim().length > 10);
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

    if (!posts?.length) throw new Error(`full-site: 0 posts from ${state.articleCount} articles for "${handle}"`);
    return this.convertPosts(posts, sinceCursor);
  }

  // ─── Conversion ───────────────────────────────────────────────────────────

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
        url: post.url, title: null, textContent: post.text || null,
        publishTime: post.timestamp, contentType: 'post', authorName: this.source.name,
        hasMedia: false, engagementSnapshot: { likes: post.likes, comments: post.comments, shares: post.shares },
      });
    }
    return { rawItems, newCursor: latestTimestamp ?? sinceCursor };
  }
}
