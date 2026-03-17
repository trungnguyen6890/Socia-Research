import { BaseConnector } from './base';
import { FetchResult, RawItem } from '../types';

const BASE = 'https://graph.facebook.com/v19.0';

export class InstagramProConnector extends BaseConnector {
  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const token = this.env.IG_ACCESS_TOKEN;
    if (!token) throw new Error('IG_ACCESS_TOKEN not set');

    const params = new URLSearchParams({
      access_token: token,
      fields: 'id,caption,timestamp,permalink,like_count,comments_count,media_type',
      limit: String(this.maxResults()),
      ...(sinceCursor ? { since: sinceCursor } : {}),
    });

    const res = await this.rateLimitedFetch(
      `${BASE}/${this.source.url_or_handle}/media?${params}`,
    );
    if (!res.ok) throw new Error(`Instagram API failed: ${res.status}`);
    const data: { data: IGMedia[] } = await res.json();

    let latestTime: string | null = null;
    const rawItems: RawItem[] = data.data.map((media) => {
      if (!latestTime) latestTime = media.timestamp;
      return {
        url: media.permalink,
        title: null,
        textContent: media.caption ?? null,
        publishTime: media.timestamp,
        engagementSnapshot: {
          likes: media.like_count ?? 0,
          comments: media.comments_count ?? 0,
          media_type: media.media_type,
        },
        rawData: media as unknown as Record<string, unknown>,
      };
    });

    return { rawItems, newCursor: latestTime ?? sinceCursor };
  }
}

interface IGMedia {
  id: string;
  caption?: string;
  timestamp: string;
  permalink: string;
  like_count?: number;
  comments_count?: number;
  media_type: string;
}
