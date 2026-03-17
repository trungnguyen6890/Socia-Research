'use client';

import { useEffect, useState } from 'react';
import { getKeywords } from '@/lib/api';
import type { Keyword } from '@/lib/types';
import PageHeader from '@/components/page-header';
import Badge from '@/components/badge';
import EmptyState from '@/components/empty-state';

export default function KeywordsPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  useEffect(() => { getKeywords().then(setKeywords); }, []);

  const categories = [...new Set(keywords.map(k => k.category))];

  return (
    <>
      <PageHeader
        title="Keywords"
        description="Keywords for auto-tagging content items"
        action={
          <button className="text-[13px] px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors">
            + Add keyword
          </button>
        }
      />

      {keywords.length === 0 ? (
        <EmptyState message="No keywords yet" description="Add keywords to auto-tag collected content" />
      ) : (
        <div className="space-y-6">
          {categories.map(cat => (
            <div key={cat}>
              <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-2">{cat}</h3>
              <div className="block-section">
                <table className="notion-table">
                  <thead>
                    <tr>
                      <th>Keyword</th>
                      <th>Match mode</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {keywords.filter(k => k.category === cat).map(k => (
                      <tr key={k.id}>
                        <td className="font-medium text-neutral-700">{k.keyword}</td>
                        <td><Badge variant="muted">{k.match_mode}</Badge></td>
                        <td><Badge variant={k.is_active ? 'success' : 'muted'}>{k.is_active ? 'active' : 'inactive'}</Badge></td>
                        <td>
                          <div className="flex gap-1">
                            <button className="text-[11px] px-2 py-1 rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-50">Edit</button>
                            <button className="text-[11px] px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50">Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
