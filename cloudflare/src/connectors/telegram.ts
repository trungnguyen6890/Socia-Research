import { BaseConnector } from './base';
import { FetchResult, RawItem } from '../types';

/**
 * Telegram connector using the Bot API.
 * source.url_or_handle = channel username (e.g. @channelname or channelname)
 * Requires bot to be added as admin to the channel.
 */
const BASE = 'https://api.telegram.org';

export class TelegramConnector extends BaseConnector {
  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const token = this.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

    const chatId = this.source.url_or_handle.startsWith('@')
      ? this.source.url_or_handle
      : `@${this.source.url_or_handle}`;

    const params = new URLSearchParams({
      chat_id: chatId,
      limit: String(this.maxResults()),
      ...(sinceCursor ? { offset: sinceCursor } : {}),
    });

    const res = await this.rateLimitedFetch(
      `${BASE}/bot${token}/getUpdates?${params}`,
    );
    if (!res.ok) throw new Error(`Telegram API failed: ${res.status}`);
    const data: { ok: boolean; result: TelegramUpdate[] } = await res.json();

    if (!data.ok) throw new Error('Telegram API returned ok=false');

    let latestOffset: string | null = null;
    const rawItems: RawItem[] = [];

    for (const update of data.result) {
      const msg = update.channel_post ?? update.message;
      if (!msg) continue;

      latestOffset = String(update.update_id + 1);
      const channelName = this.source.url_or_handle.replace('@', '');
      const url = `https://t.me/${channelName}/${msg.message_id}`;

      rawItems.push({
        url,
        title: null,
        textContent: msg.text ?? msg.caption ?? null,
        publishTime: new Date(msg.date * 1000).toISOString(),
        engagementSnapshot: {
          views: msg.views ?? 0,
          forwards: msg.forward_count ?? 0,
        },
        rawData: update as unknown as Record<string, unknown>,
      });
    }

    return { rawItems, newCursor: latestOffset ?? sinceCursor };
  }
}

interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  views?: number;
  forward_count?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}
