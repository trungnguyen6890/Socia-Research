'use client';

import { useEffect, useState } from 'react';
import { getSchedules, getSources } from '@/lib/api';
import { fmtRelative } from '@/lib/utils';
import type { Schedule, Source } from '@/lib/types';
import PageHeader from '@/components/page-header';
import Badge from '@/components/badge';
import EmptyState from '@/components/empty-state';

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [sources, setSources] = useState<Source[]>([]);

  useEffect(() => {
    getSchedules().then(setSchedules);
    getSources().then(setSources);
  }, []);

  const sourceName = (id: string) => sources.find(s => s.id === id)?.name ?? 'Unknown';

  return (
    <>
      <PageHeader
        title="Schedules"
        description="Per-source cron schedules for automated fetching"
        action={
          <button className="text-[13px] px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors">
            + Add schedule
          </button>
        }
      />

      {schedules.length === 0 ? (
        <EmptyState
          message="No schedules configured"
          description="Schedules let you set per-source fetch intervals. The global cron interval is configured in Settings."
        />
      ) : (
        <div className="block-section">
          <table className="notion-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Cron expression</th>
                <th>Status</th>
                <th>Last run</th>
                <th>Next run</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id}>
                  <td className="font-medium text-neutral-700">{s.source_name ?? sourceName(s.source_id)}</td>
                  <td>
                    <code className="text-[12px] bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-600">{s.cron_expression}</code>
                  </td>
                  <td>
                    <Badge variant={s.is_active ? 'success' : 'muted'}>
                      {s.is_active ? 'active' : 'inactive'}
                    </Badge>
                  </td>
                  <td className="text-[12px] text-neutral-400">{fmtRelative(s.last_run_at)}</td>
                  <td className="text-[12px] text-neutral-400">{fmtRelative(s.next_run_at)}</td>
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
      )}
    </>
  );
}
