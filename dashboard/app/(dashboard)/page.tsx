'use client';

import { useEffect, useState } from 'react';
import { getDashboardStats, getRecentRuns, getContent, getSources } from '@/lib/api';
import { fmtRelative, CONNECTOR_COLORS, cn } from '@/lib/utils';
import type { DashboardStats, RunLog, ContentItem, Source } from '@/lib/types';
import PageHeader from '@/components/page-header';
import Badge from '@/components/badge';
import ScoreBar from '@/components/score-bar';
import Link from 'next/link';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getDashboardStats(),
      getRecentRuns(),
      getContent(),
      getSources(),
    ]).then(([s, r, c, src]) => {
      setStats(s);
      setRuns(r);
      setContent(c.items);
      setSources(src);
    }).catch(err => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" description="Overview of your research pipeline" />
        <div className="block-section px-4 py-6 text-center">
          <p className="text-[13px] text-red-500 mb-2">Failed to load dashboard data</p>
          <p className="text-[12px] text-neutral-400">{error}</p>
          <p className="text-[12px] text-neutral-400 mt-2">
            Set <code className="bg-neutral-100 px-1 rounded">NEXT_PUBLIC_API_URL</code> and <code className="bg-neutral-100 px-1 rounded">NEXT_PUBLIC_ADMIN_PASSWORD</code> environment variables.
          </p>
        </div>
      </>
    );
  }

  if (!stats) {
    return (
      <>
        <PageHeader title="Dashboard" description="Overview of your research pipeline" />
        <div className="text-[13px] text-neutral-400">Loading…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Dashboard" description="Overview of your research pipeline" />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-10">
        {[
          { label: 'Total items', value: stats.totalItems },
          { label: 'Last 24h', value: stats.items24h },
          { label: 'Active sources', value: `${stats.activeSources} / ${stats.totalSources}` },
          { label: 'Recent runs', value: runs.length },
        ].map((s) => (
          <div key={s.label} className="border border-neutral-200 rounded-lg px-4 py-4">
            <div className="text-[11px] text-neutral-400 uppercase tracking-wider mb-1">{s.label}</div>
            <div className="text-2xl font-semibold text-neutral-900 tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-2 gap-8 mb-10">
        {/* Recent Runs */}
        <div>
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3">Recent Runs</h2>
          <div className="block-section">
            <table className="notion-table">
              <thead><tr><th>Source</th><th>Status</th><th>Items</th><th>Time</th></tr></thead>
              <tbody>
                {runs.slice(0, 10).map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-neutral-700">{r.source_name ?? '—'}</td>
                    <td><Badge variant={r.status === 'success' ? 'success' : 'error'}>{r.status}</Badge></td>
                    <td className="text-neutral-500 tabular-nums">{r.items_fetched}</td>
                    <td className="text-neutral-400 text-[12px]">{fmtRelative(r.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sources */}
        <div>
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3">Sources</h2>
          <div className="block-section">
            <table className="notion-table">
              <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Last fetch</th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td><Link href="/sources" className="font-medium text-neutral-700 hover:text-neutral-900">{s.name}</Link></td>
                    <td><Badge className={cn(CONNECTOR_COLORS[s.connector_type])}>{s.connector_type}</Badge></td>
                    <td><Badge variant={s.is_active ? 'success' : 'muted'}>{s.is_active ? 'active' : 'off'}</Badge></td>
                    <td className="text-neutral-400 text-[12px]">{fmtRelative(s.last_fetched_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent Content */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Recent Content</h2>
          <Link href="/content" className="text-xs text-neutral-400 hover:text-neutral-600">View all →</Link>
        </div>
        <div className="block-section divide-y divide-neutral-100">
          {content.slice(0, 5).map((item) => (
              <div key={item.id} className="px-4 py-3 hover:bg-neutral-50/50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={cn(CONNECTOR_COLORS[item.source_type])}>{item.source_type}</Badge>
                      <span className="text-[11px] text-neutral-400">{item.source}</span>
                      <span className="text-[11px] text-neutral-300">·</span>
                      <span className="text-[11px] text-neutral-400">{fmtRelative(item.published_at ?? item.fetch_time)}</span>
                    </div>
                    <p className="text-sm font-medium text-neutral-800">{item.title ?? 'Untitled'}</p>
                    {item.content_text && (
                      <p className="text-[13px] text-neutral-500 mt-0.5 line-clamp-2">{item.content_text}</p>
                    )}
                    {item.tags.length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        {item.tags.map(t => <span key={t} className="text-[10px] text-neutral-400 bg-neutral-50 px-1.5 py-0.5 rounded">{t}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-3">
                    <ScoreBar score={item.quality_score} label="Q" />
                    <ScoreBar score={item.signal_score} label="S" />
                  </div>
                </div>
              </div>
          ))}
        </div>
      </div>
    </>
  );
}
