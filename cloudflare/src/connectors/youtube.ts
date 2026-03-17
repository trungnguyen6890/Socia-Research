import { BaseConnector } from './base';
import { FetchResult, RawItem } from '../types';

const BASE = 'https://www.googleapis.com/youtube/v3';

export class YouTubeConnector extends BaseConnector {
  async fetch(sinceCursor: string | null): Promise<FetchResult> {
    const key = this.env.YOUTUBE_API_KEY;
    if (!key) throw new Error('YOUTUBE_API_KEY not set');

    // Step 1: Get the channel's uploads playlist ID
    const uploadsPlaylistId = await this.getUploadsPlaylistId(key);

    // Step 2: Fetch videos from the uploads playlist
    const params = new URLSearchParams({
      key,
      playlistId: uploadsPlaylistId,
      part: 'snippet',
      maxResults: String(this.maxResults()),
    });

    const res = await this.rateLimitedFetch(`${BASE}/playlistItems?${params}`);
    if (!res.ok) throw new Error(`YouTube playlistItems failed: ${res.status}`);
    const data: { items: PlaylistItem[] } = await res.json();

    // Filter by cursor (publishedAt ISO string)
    const all = data.items.filter((i) => {
      if (!sinceCursor) return true;
      return i.snippet.publishedAt > sinceCursor;
    });

    const videoIds = all.map((i) => i.snippet.resourceId.videoId).filter(Boolean);
    const statsMap = videoIds.length ? await this.fetchStats(videoIds, key) : {};

    let latestTime: string | null = null;
    const rawItems: RawItem[] = all.map((item) => {
      const s = item.snippet;
      const videoId = s.resourceId.videoId;
      if (!latestTime || s.publishedAt > latestTime) latestTime = s.publishedAt;
      const stats = statsMap[videoId] ?? {};
      return {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: s.title,
        textContent: s.description,
        publishTime: s.publishedAt,
        engagementSnapshot: {
          views: Number(stats.viewCount ?? 0),
          likes: Number(stats.likeCount ?? 0),
          comments: Number(stats.commentCount ?? 0),
        },
        rawData: { ...item, statistics: stats },
      };
    });

    return { rawItems, newCursor: latestTime ?? sinceCursor };
  }

  private async getUploadsPlaylistId(key: string): Promise<string> {
    const handle = this.source.url_or_handle;

    // Support both channel ID (UC...) and @handle
    const isChannelId = handle.startsWith('UC');
    const params = new URLSearchParams({
      key,
      part: 'contentDetails',
      ...(isChannelId ? { id: handle } : { forHandle: handle.replace('@', '') }),
    });

    const res = await this.rateLimitedFetch(`${BASE}/channels?${params}`);
    if (!res.ok) throw new Error(`YouTube channels lookup failed: ${res.status}`);
    const data: { items?: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }> } = await res.json();

    const uploadsId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) throw new Error(`YouTube channel not found: ${handle}`);
    return uploadsId;
  }

  private async fetchStats(ids: string[], key: string): Promise<Record<string, YoutubeStats>> {
    const params = new URLSearchParams({ key, id: ids.join(','), part: 'statistics' });
    const res = await this.rateLimitedFetch(`${BASE}/videos?${params}`);
    if (!res.ok) return {};
    const data: { items: Array<{ id: string; statistics: YoutubeStats }> } = await res.json();
    return Object.fromEntries(data.items.map((i) => [i.id, i.statistics]));
  }
}

interface PlaylistItem {
  snippet: {
    publishedAt: string;
    title: string;
    description: string;
    resourceId: { videoId: string };
  };
}

interface YoutubeStats {
  viewCount?: string;
  likeCount?: string;
  commentCount?: string;
}
