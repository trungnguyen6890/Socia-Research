import { BaseConnector } from './base';
import { FetchResult, RawItem } from '../types';

export class RSSConnector extends BaseConnector {
  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const res = await this.rateLimitedFetch(this.source.url_or_handle);
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
    const xml = await res.text();
    return this.parseXml(xml, sinceCursor);
  }

  private parseXml(xml: string, sinceCursor: string | null): FetchResult {
    const rawItems: RawItem[] = [];
    let latestId: string | null = null;

    // Parse <item> or <entry> elements
    const isAtom = xml.includes('<feed');
    const itemRegex = isAtom
      ? /<entry>([\s\S]*?)<\/entry>/g
      : /<item>([\s\S]*?)<\/item>/g;

    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const id = isAtom ? this.extractTag(block, 'id') : (this.extractTag(block, 'guid') ?? this.extractTag(block, 'link'));
      if (sinceCursor && id === sinceCursor) break;
      if (latestId === null && id) latestId = id;

      const link = isAtom
        ? (block.match(/href="([^"]+)"/) ?? [])[1] ?? ''
        : this.extractTag(block, 'link') ?? '';
      const title = this.extractTag(block, 'title');
      const summary = this.extractTag(block, isAtom ? 'summary' : 'description');
      const content = this.extractTag(block, 'content:encoded') ?? this.extractTag(block, 'content');
      const published = this.extractTag(block, isAtom ? 'published' : 'pubDate');

      rawItems.push({
        url: link,
        title: this.stripCdata(title),
        textContent: this.stripCdata(content ?? summary),
        publishTime: published ?? null,
        rawData: { id, title, link, summary, published },
      });
    }

    return { rawItems, newCursor: latestId ?? sinceCursor };
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
