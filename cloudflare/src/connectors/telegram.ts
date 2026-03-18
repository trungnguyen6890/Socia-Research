import { BaseConnector } from './base';
import { launchBrowser } from '../browser';
import { FetchResult, RawItem } from '../types';

/**
 * Telegram public channel connector via t.me/s/{channel} + Puppeteer.
 *
 * Approach summary:
 * - gramjs/MTProto: NOT viable in CF Workers (gramjs only has TCP transport,
 *   CF Workers has no outbound raw socket support).
 * - Bot API (getUpdates): only works when bot is a member — useless for
 *   monitoring arbitrary public channels.
 * - t.me/s/{channel}: Telegram's official public channel preview, loads posts
 *   via JS → render with Puppeteer. No auth, works for any public channel.
 *
 * source.url_or_handle — @channelname, channelname, or https://t.me/channelname
 *
 * config keys:
 *   max_results    — max posts per fetch (default: 20)
 *   lookback_days  — ignore posts older than N days (default: 7)
 */
export class TelegramConnector extends BaseConnector {

  private extractHandle(): string {
    let h = this.source.url_or_handle.trim();
    h = h.replace(/^https?:\/\/t\.me\//i, '');
    h = h.replace(/^@/, '').split('/')[0];
    return h;
  }

  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const handle = this.extractHandle();
    if (!handle) throw new Error('No Telegram channel handle in url_or_handle');

    const lookbackDays = (this.config.lookback_days as number) ?? 7;
    const cutoffMs = Date.now() - lookbackDays * 86_400_000;
    const sinceId = sinceCursor ? Number(sinceCursor) : 0;

    const browser = await launchBrowser(this.env);

    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1280, height: 900 });

      // t.me/s is Telegram's official embed widget — loads messages via JS
      await page.goto(`https://t.me/s/${handle}`, {
        waitUntil: 'networkidle0',
        timeout: 25000,
      });

      // Wait for message elements to appear
      await page.waitForSelector(
        '.tgme_widget_message, .tgme_channel_info',
        { timeout: 10000 }
      ).catch(() => {});

      const messages = await page.evaluate((sinceIdVal: number) => {
        function parseKM(raw: string): number {
          const s = raw.trim().toUpperCase();
          if (s.endsWith('K')) return Math.round(parseFloat(s) * 1_000);
          if (s.endsWith('M')) return Math.round(parseFloat(s) * 1_000_000);
          return parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
        }

        const results: Array<{
          id: number;
          text: string;
          isoDate: string | null;
          timestampMs: number | null;
          views: number;
          reactions: number;
          hasMedia: boolean;
          url: string;
        }> = [];

        document.querySelectorAll<HTMLElement>('.tgme_widget_message').forEach(el => {
          // Extract message ID from data-post="channelname/123"
          const dataPost = el.getAttribute('data-post') ?? '';
          const id = Number(dataPost.split('/')[1] ?? 0);
          if (!id || id <= sinceIdVal) return;

          // Text
          const textEl = el.querySelector<HTMLElement>('.tgme_widget_message_text');
          const text = textEl?.innerText?.trim() ?? '';

          // Timestamp
          const timeEl = el.querySelector<HTMLElement>('time[datetime]');
          const isoDate = timeEl?.getAttribute('datetime') ?? null;
          const timestampMs = isoDate ? new Date(isoDate).getTime() : null;

          // Views — "1.2K", "10.5K", "1M"
          const viewsEl = el.querySelector<HTMLElement>('.tgme_widget_message_views');
          const views = parseKM(viewsEl?.textContent ?? viewsEl?.innerText ?? '0');

          // Reactions — <div class="tgme_widget_message_reactions">
          //   <span class="tgme_reaction"><i class="emoji"><b>👍</b></i>6</span>
          let reactions = 0;
          el.querySelectorAll<HTMLElement>('.tgme_reaction').forEach(span => {
            const emojiText = span.querySelector<HTMLElement>('b')?.textContent ?? '';
            const countText = (span.textContent ?? '').replace(emojiText, '').trim();
            reactions += parseKM(countText);
          });

          // Media
          const hasMedia = !!(
            el.querySelector('.tgme_widget_message_photo_wrap') ||
            el.querySelector('.tgme_widget_message_video_wrap') ||
            el.querySelector('.tgme_widget_message_document_wrap') ||
            el.querySelector('.tgme_widget_message_sticker_wrap')
          );

          // Post URL
          const linkEl = el.querySelector<HTMLAnchorElement>('a.tgme_widget_message_date');
          const url = linkEl?.href ?? '';

          results.push({ id, text, isoDate, timestampMs, views, reactions, hasMedia, url });
        });

        return results;
      }, sinceId);

      if (!messages || messages.length === 0) {
        // Check if the channel exists at all
        const pageTitle = await page.title();
        if (pageTitle.toLowerCase().includes('404') || pageTitle.toLowerCase().includes('not found')) {
          throw new Error(`Channel @${handle} not found or is private`);
        }
        // Empty channel or no new posts since cursor
        return { rawItems: [], newCursor: sinceCursor };
      }

      const rawItems: RawItem[] = [];
      let latestId: string | null = null;

      // Sort newest first
      const sorted = [...messages].sort((a, b) => b.id - a.id);

      for (const msg of sorted) {
        if (rawItems.length >= this.maxResults()) break;
        if (msg.timestampMs && msg.timestampMs < cutoffMs) continue;

        if (!latestId) latestId = String(msg.id);

        rawItems.push({
          url: msg.url || `https://t.me/${handle}/${msg.id}`,
          title: null,
          textContent: msg.text || null,
          publishTime: msg.isoDate,
          contentType: 'message',
          authorName: handle,
          hasMedia: msg.hasMedia,
          engagementSnapshot: { views: msg.views, reactions: msg.reactions },
          rawData: { id: msg.id, handle },
        });
      }

      return { rawItems, newCursor: latestId ?? sinceCursor };

    } finally {
      await browser.close();
    }
  }
}
