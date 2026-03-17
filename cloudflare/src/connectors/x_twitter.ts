import { BaseConnector } from './base';
import { FetchResult, RawItem } from '../types';

const BASE = 'https://api.twitter.com/2';

export class XTwitterConnector extends BaseConnector {
  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const token = this.env.X_BEARER_TOKEN;
    if (!token) throw new Error('X_BEARER_TOKEN not set');

    const params = new URLSearchParams({
      'tweet.fields': 'created_at,public_metrics,text',
      max_results: String(Math.min(this.maxResults(), 10)),
      ...(sinceCursor ? { since_id: sinceCursor } : {}),
    });

    const userId = this.source.url_or_handle;
    const res = await this.rateLimitedFetch(
      `${BASE}/users/${userId}/tweets?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`X API failed: ${res.status}`);
    const data: { data?: XTweet[]; meta?: { newest_id?: string } } = await res.json();

    const username = (this.config.username as string) ?? userId;
    let latestId: string | null = data.meta?.newest_id ?? null;

    const rawItems: RawItem[] = (data.data ?? []).map((tweet) => {
      const m = tweet.public_metrics;
      return {
        url: `https://x.com/${username}/status/${tweet.id}`,
        title: null,
        textContent: tweet.text,
        publishTime: tweet.created_at,
        engagementSnapshot: {
          likes: m.like_count,
          retweets: m.retweet_count,
          replies: m.reply_count,
          impressions: m.impression_count ?? 0,
        },
        rawData: tweet as unknown as Record<string, unknown>,
      };
    });

    return { rawItems, newCursor: latestId ?? sinceCursor };
  }
}

interface XTweet {
  id: string;
  text: string;
  created_at: string;
  public_metrics: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    impression_count?: number;
  };
}
