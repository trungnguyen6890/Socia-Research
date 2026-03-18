import { BaseConnector } from './base';
import { FetchResult, RawItem } from '../types';

/**
 * Website connector using Cloudflare's HTMLRewriter.
 *
 * source.config keys:
 *   item_selector   — CSS selector for each content card/row  (default: "article")
 *   title_selector  — selector for title inside item          (default: "h2")
 *   link_selector   — selector for <a> inside item           (default: "a")
 *   text_selector   — selector for body text inside item     (default: "p")
 *
 * HTMLRewriter does NOT support comma-separated selectors in one call,
 * so split multi-selectors with | and we register each separately.
 * Example: title_selector = "h2|h3|.title"
 */
export class WebsiteConnector extends BaseConnector {
  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const res = await this.rateLimitedFetch(this.source.url_or_handle, {
      headers: { 'User-Agent': 'SociaResearch/0.1 (research bot)' },
    });
    if (!res.ok) throw new Error(`Website fetch failed: ${res.status} ${this.source.url_or_handle}`);

    const itemSel   = (this.config.item_selector  as string) ?? 'article';
    const titleSels = ((this.config.title_selector as string) ?? 'h2').split('|').map(s => s.trim()).filter(Boolean);
    const linkSel   = (this.config.link_selector   as string) ?? 'a';
    const textSels  = ((this.config.text_selector  as string) ?? 'p').split('|').map(s => s.trim()).filter(Boolean);

    type Item = { title: string; link: string; text: string };
    const items: Item[] = [];
    let current: Item | null = null;
    let inTitle = false;
    let inText  = false;

    let rewriter = new HTMLRewriter()
      // New item container
      .on(itemSel, {
        element() {
          current = { title: '', link: '', text: '' };
          items.push(current);
        },
      })
      // First link href inside item
      .on(`${itemSel} ${linkSel}`, {
        element(el) {
          const href = el.getAttribute('href');
          if (href && current && !current.link) current.link = href;
        },
      });

    // Register title selectors
    for (const sel of titleSels) {
      rewriter = rewriter.on(`${itemSel} ${sel}`, {
        element(el) {
          inTitle = true;
          el.onEndTag(() => { inTitle = false; });
        },
        text(chunk) {
          if (inTitle && current) current.title += chunk.text;
        },
      });
    }

    // Register text selectors
    for (const sel of textSels) {
      rewriter = rewriter.on(`${itemSel} ${sel}`, {
        element(el) {
          inText = true;
          el.onEndTag(() => { inText = false; });
        },
        text(chunk) {
          if (inText && current && current.text.length < 500) current.text += chunk.text;
        },
      });
    }

    await rewriter.transform(res).arrayBuffer();

    const baseUrl = new URL(this.source.url_or_handle).origin;

    const rawItems: RawItem[] = items
      .filter(i => i.link) // skip items with no link
      .map((item) => {
        const link = item.link.startsWith('http') ? item.link : `${baseUrl}${item.link}`;
        return {
          url: link,
          title: item.title.trim() || null,
          textContent: item.text.trim() || null,
          publishTime: null,
        };
      });

    // Dedupe by URL within this batch
    const seen = new Set<string>();
    const unique = rawItems.filter(i => {
      if (seen.has(i.url)) return false;
      seen.add(i.url);
      return true;
    });

    // Website has no native "since" API — pass all items and rely on DB dedupe in the pipeline.
    // Cursor stores the latest URL seen as a reference only.
    const latestUrl = unique[0]?.url ?? null;

    return { rawItems: unique, newCursor: latestUrl ?? sinceCursor };
  }
}
