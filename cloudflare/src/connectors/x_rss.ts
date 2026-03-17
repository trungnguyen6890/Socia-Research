import { BaseConnector } from './base';
import { FetchResult, RawItem } from '../types';

/**
 * X/Twitter via Nitter RSS.
 *
 * source.url_or_handle  — Twitter username, with or without @
 *                         e.g. "sama" or "@sama"
 *
 * config keys:
 *   nitter_instance     — base URL of the Nitter instance to use
 *                         (default: "https://nitter.net")
 *   include_retweets    — true | false (default: false)
 *   max_results         — max items to keep (default: 25)
 */
export class XRssConnector extends BaseConnector {
  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const username = this.source.url_or_handle.replace(/^@/, '');
    const instance = ((this.config.nitter_instance as string) ?? 'https://nitter.net').replace(/\/$/, '');
    const includeRetweets = Boolean(this.config.include_retweets ?? false);

    const feedUrl = `${instance}/${username}/rss`;
    const res = await this.rateLimitedFetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
    if (!res.ok) throw new Error(`Nitter RSS failed: ${res.status} ${feedUrl}`);

    const xml = await res.text();
    return this.parseXml(xml, sinceCursor, username, includeRetweets);
  }

  private parseXml(
    xml: string,
    sinceCursor: string | null,
    username: string,
    includeRetweets: boolean,
  ): FetchResult {
    const rawItems: RawItem[] = [];
    let latestGuid: string | null = null;

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];

      const guid = this.extractTag(block, 'guid');
      const title = this.stripCdata(this.extractTag(block, 'title'));
      const link = this.extractTag(block, 'link');
      const pubDate = this.extractTag(block, 'pubDate');
      const description = this.stripCdata(this.extractTag(block, 'description'));

      // Stop at cursor (already seen)
      if (sinceCursor && guid === sinceCursor) break;
      if (latestGuid === null && guid) latestGuid = guid;

      // Skip retweets unless opted in
      if (!includeRetweets && title && /^RT by /i.test(title)) continue;

      // Resolve canonical Twitter URL
      const canonicalUrl = this.toTwitterUrl(link ?? guid ?? '', username);

      // Strip HTML tags from description (Nitter wraps content in <p>)
      const text = description ? description.replace(/<[^>]+>/g, '').trim() : null;

      rawItems.push({
        url: canonicalUrl,
        title: null,           // tweets don't have a title
        textContent: text,
        publishTime: pubDate ?? null,
        rawData: { guid, title, link, pubDate, description },
      });

      if (rawItems.length >= this.maxResults()) break;
    }

    return { rawItems, newCursor: latestGuid ?? sinceCursor };
  }

  private toTwitterUrl(url: string, username: string): string {
    // Convert nitter URL → twitter URL for canonical dedup
    // e.g. https://nitter.net/sama/status/123 → https://x.com/sama/status/123
    try {
      const u = new URL(url);
      return `https://x.com${u.pathname}`;
    } catch {
      return `https://x.com/${username}`;
    }
  }

  private extractTag(xml: string, tag: string): string | null {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  }

  private stripCdata(s: string | null): string | null {
    if (!s) return null;
    return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  }
}
