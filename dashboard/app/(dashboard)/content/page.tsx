'use client';

import { useEffect, useState } from 'react';
import { getContent, getSources } from '@/lib/api';
import { fmtRelative, fmtDate, CONNECTOR_COLORS, cn } from '@/lib/utils';
import type { ContentItem, Source } from '@/lib/types';
import PageHeader from '@/components/page-header';
import Badge from '@/components/badge';
import ScoreBar from '@/components/score-bar';
import EmptyState from '@/components/empty-state';

export default function ContentPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { getSources().then(setSources); }, []);
  useEffect(() => {
    getContent({ search: search || undefined, sourceId: sourceFilter || undefined }).then(r => {
      setItems(r.items);
      setTotal(r.total);
    });
  }, [search, sourceFilter]);

  return (
    <>
      <PageHeader title="Content" description={`${total} items collected`} />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search content…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-[13px] px-3 py-1.5 border border-neutral-200 rounded-md bg-white text-neutral-700 placeholder:text-neutral-300 w-64 focus:outline-none focus:border-neutral-400"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="text-[13px] px-3 py-1.5 border border-neutral-200 rounded-md bg-white text-neutral-600 focus:outline-none focus:border-neutral-400"
        >
          <option value="">All sources</option>
          {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState message="No content found" description="Try adjusting your filters or add sources to start collecting" />
      ) : (
        <div className="block-section divide-y divide-neutral-100">
          {items.map((item) => {
            const eng = item.engagement;
            const isExpanded = expanded === item.id;
            return (
              <div
                key={item.id}
                className="px-4 py-3 hover:bg-neutral-50/30 transition-colors cursor-pointer"
                onClick={() => setExpanded(isExpanded ? null : item.id)}
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={cn(CONNECTOR_COLORS[item.source_type])}>{item.source_type}</Badge>
                      <span className="text-[11px] text-neutral-400">{item.source ?? 'Unknown source'}</span>
                      <span className="text-[11px] text-neutral-300">·</span>
                      <span className="text-[11px] text-neutral-400">{fmtRelative(item.published_at ?? item.fetch_time)}</span>
                      {item.duplicate_key ? <Badge variant="warning">dup</Badge> : null}
                    </div>
                    <p className="text-sm font-medium text-neutral-800">{item.title ?? 'Untitled'}</p>
                    {!isExpanded && item.content_text && (
                      <p className="text-[13px] text-neutral-500 mt-0.5 line-clamp-2">{item.content_text}</p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-3">
                    <ScoreBar score={item.quality_score} label="Q" />
                    <ScoreBar score={item.signal_score} label="S" />
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-4 ml-0 border-t border-neutral-100 pt-4">
                    {item.content_text ? (
                      <p className="text-[13px] text-neutral-600 leading-relaxed whitespace-pre-wrap mb-4">
                        {item.content_text}
                      </p>
                    ) : (
                      <p className="text-[13px] text-neutral-400 italic mb-4">Content not available</p>
                    )}

                    <div className="grid grid-cols-3 gap-6 text-[12px]">
                      <div>
                        <div className="text-[11px] text-neutral-400 uppercase tracking-wider mb-1.5">Meta</div>
                        <p className="text-neutral-500"><span className="text-neutral-400">Published:</span> {fmtDate(item.published_at)}</p>
                        <p className="text-neutral-500"><span className="text-neutral-400">Fetched:</span> {fmtDate(item.fetch_time)}</p>
                        <p className="text-neutral-500">
                          <span className="text-neutral-400">URL:</span>{' '}
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-neutral-600 hover:underline">{item.url.slice(0, 50)}…</a>
                        </p>
                      </div>
                      <div>
                        <div className="text-[11px] text-neutral-400 uppercase tracking-wider mb-1.5">Engagement</div>
                        {(eng.views > 0 || eng.likes > 0 || eng.comments > 0 || eng.shares > 0 || eng.reactions > 0) ? (
                          <>
                            {eng.views > 0 && <p className="text-neutral-500"><span className="text-neutral-400">views:</span> {eng.views.toLocaleString()}</p>}
                            {eng.reactions > 0 && <p className="text-neutral-500"><span className="text-neutral-400">reactions:</span> {eng.reactions.toLocaleString()}</p>}
                            {eng.likes > 0 && <p className="text-neutral-500"><span className="text-neutral-400">likes:</span> {eng.likes.toLocaleString()}</p>}
                            {eng.comments > 0 && <p className="text-neutral-500"><span className="text-neutral-400">comments:</span> {eng.comments.toLocaleString()}</p>}
                            {eng.shares > 0 && <p className="text-neutral-500"><span className="text-neutral-400">shares:</span> {eng.shares.toLocaleString()}</p>}
                          </>
                        ) : (
                          <p className="text-neutral-400 italic">No engagement data</p>
                        )}
                      </div>
                      <div>
                        <div className="text-[11px] text-neutral-400 uppercase tracking-wider mb-1.5">Tags</div>
                        {item.tags.length > 0 ? (
                          <div className="flex gap-1 flex-wrap">
                            {item.tags.map(t => <span key={t} className="text-[10px] text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded">{t}</span>)}
                          </div>
                        ) : (
                          <p className="text-neutral-400 italic">No tags</p>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                      <button onClick={(e) => { e.stopPropagation(); console.log('send to analyst', item.id); }}
                        className="text-[11px] px-3 py-1 rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-50">
                        Send to Analyst Bot
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); console.log('save', item.id); }}
                        className="text-[11px] px-3 py-1 rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-50">
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
