import { BaseConnector } from './base';
import { FetchResult, RawItem } from '../types';

const BASE = 'https://graph.facebook.com/v19.0';

export class FacebookPageConnector extends BaseConnector {
  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const token = this.env.FB_ACCESS_TOKEN;
    if (!token) throw new Error('FB_ACCESS_TOKEN not set');

    const params = new URLSearchParams({
      access_token: token,
      fields: 'id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true)',
      limit: String(this.maxResults()),
      ...(sinceCursor ? { since: sinceCursor } : {}),
    });

    const res = await this.rateLimitedFetch(
      `${BASE}/${this.source.url_or_handle}/posts?${params}`,
    );
    if (!res.ok) throw new Error(`Facebook API failed: ${res.status}`);
    const data: { data: FBPost[] } = await res.json();

    let latestTime: string | null = null;
    const rawItems: RawItem[] = data.data.map((post) => {
      if (!latestTime) latestTime = post.created_time;
      return {
        url: post.permalink_url ?? `https://facebook.com/${post.id}`,
        title: null,
        textContent: post.message ?? null,
        publishTime: post.created_time,
        contentType: 'post',
        authorName: this.source.name,
        hasMedia: false,
        engagementSnapshot: {
          likes: post.likes?.summary?.total_count ?? 0,
          shares: post.shares?.count ?? 0,
          comments: post.comments?.summary?.total_count ?? 0,
        },
        rawData: post as unknown as Record<string, unknown>,
      };
    });

    return { rawItems, newCursor: latestTime ?? sinceCursor };
  }
}

interface FBPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  shares?: { count: number };
  likes?: { summary: { total_count: number } };
  comments?: { summary: { total_count: number } };
}
