'use client';

import { useEffect, useState } from 'react';
import { getGoals } from '@/lib/api';
import type { Goal } from '@/lib/types';
import PageHeader from '@/components/page-header';
import Badge from '@/components/badge';
import EmptyState from '@/components/empty-state';

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { getGoals().then(setGoals); }, []);

  return (
    <>
      <PageHeader
        title="Research Goals"
        description="Goals drive signal scoring — items matching goal keywords score higher"
        action={
          <button className="text-[13px] px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors">
            + Add goal
          </button>
        }
      />

      {goals.length === 0 ? (
        <EmptyState message="No goals yet" description="Create research goals to prioritize relevant content" />
      ) : (
        <div className="space-y-3">
          {goals.map(g => {
            const isExpanded = expanded === g.id;
            return (
              <div
                key={g.id}
                className="block-section cursor-pointer hover:border-neutral-300 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : g.id)}
              >
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded bg-neutral-100 flex items-center justify-center text-[11px] text-neutral-400 font-medium">
                      {g.priority}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-neutral-800">{g.name}</p>
                      <p className="text-[12px] text-neutral-400 mt-0.5">{g.description ?? 'No description'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={g.is_active ? 'success' : 'muted'}>{g.is_active ? 'active' : 'inactive'}</Badge>
                    <span className="text-[11px] text-neutral-400">{g.keywords?.length ?? 0} keywords</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 py-3 border-t border-neutral-100 bg-neutral-50/50">
                    <div className="text-[11px] text-neutral-400 uppercase tracking-wider mb-2">Linked keywords</div>
                    {g.keywords && g.keywords.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {g.keywords.map(k => (
                          <span key={k.id} className="text-[12px] px-2 py-0.5 bg-white border border-neutral-200 rounded text-neutral-600">
                            {k.keyword} <span className="text-neutral-400">({k.category})</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-neutral-400 italic mb-3">No keywords linked</p>
                    )}
                    <div className="flex gap-2">
                      <button onClick={(e) => e.stopPropagation()} className="text-[11px] px-2.5 py-1 rounded border border-neutral-200 text-neutral-500 hover:bg-white">Edit</button>
                      <button onClick={(e) => e.stopPropagation()} className="text-[11px] px-2.5 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50">Delete</button>
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
