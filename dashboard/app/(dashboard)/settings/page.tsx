'use client';

import { useEffect, useState } from 'react';
import { getSettings, updateSettings } from '@/lib/api';
import type { Settings } from '@/lib/types';
import PageHeader from '@/components/page-header';
import { fmtDate } from '@/lib/utils';

const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(h: number) {
  return `${String(h).padStart(2, '0')}:00 UTC`;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [selectedHours, setSelectedHours] = useState<number[]>([3, 12]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      setEnabled(s.cron_enabled === '1');
      const hours = (s.cron_hours || '3,12')
        .split(',')
        .map((h) => Number(h.trim()))
        .filter((h) => !isNaN(h) && h >= 0 && h <= 23);
      setSelectedHours(hours);
    });
  }, []);

  const toggleHour = (h: number) => {
    setSelectedHours(prev =>
      prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h].sort((a, b) => a - b)
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        cron_hours: selectedHours.join(','),
        cron_enabled: enabled ? '1' : '0',
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <>
        <PageHeader title="Settings" description="Global pipeline configuration" />
        <div className="text-[13px] text-neutral-400">Loading…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" description="Global pipeline configuration" />

      <div className="max-w-xl space-y-8">
        {/* Cron Configuration */}
        <div className="block-section px-5 py-5">
          <h3 className="text-[13px] font-medium text-neutral-800 mb-4">Cron Schedule</h3>

          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] text-neutral-700">Auto-fetch enabled</p>
                <p className="text-[11px] text-neutral-400 mt-0.5">Automatically fetch from all active sources</p>
              </div>
              <button
                onClick={() => setEnabled(!enabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-green-500' : 'bg-neutral-300'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
            </div>

            <div>
              <label className="text-[13px] text-neutral-700 block mb-2">
                Run hours (UTC)
                {selectedHours.length > 0 && (
                  <span className="ml-2 text-[11px] text-neutral-400 font-normal">
                    — {selectedHours.length} time{selectedHours.length > 1 ? 's' : ''}/day
                  </span>
                )}
              </label>
              <div className="grid grid-cols-6 gap-1.5">
                {ALL_HOURS.map(h => (
                  <button
                    key={h}
                    onClick={() => toggleHour(h)}
                    className={`text-[11px] py-1 rounded border transition-colors ${
                      selectedHours.includes(h)
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'
                    }`}
                  >
                    {String(h).padStart(2, '0')}h
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-neutral-400 mt-2">
                Worker triggers every hour. Job only runs at the selected hours above.
                {selectedHours.length > 0 && (
                  <> Current schedule: {selectedHours.map(formatHour).join(', ')}.</>
                )}
              </p>
            </div>

            {settings.last_cron_run_at && (
              <div className="text-[12px] text-neutral-400 border-t border-neutral-100 pt-3">
                Last cron run: <span className="text-neutral-600">{fmtDate(settings.last_cron_run_at)}</span>
              </div>
            )}
          </div>
        </div>

        {/* API Configuration */}
        <div className="block-section px-5 py-5">
          <h3 className="text-[13px] font-medium text-neutral-800 mb-4">API Keys</h3>
          <div className="space-y-3">
            {[
              { label: 'YouTube API Key', key: 'YOUTUBE_API_KEY', hint: 'Set via wrangler secret' },
              { label: 'X Bearer Token', key: 'X_BEARER_TOKEN', hint: 'Set via wrangler secret' },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] text-neutral-700">{item.label}</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">{item.hint}</p>
                </div>
                <code className="text-[11px] bg-neutral-100 px-2 py-1 rounded text-neutral-500">{item.key}</code>
              </div>
            ))}
            <p className="text-[11px] text-neutral-400 border-t border-neutral-100 pt-3">
              API keys are stored as encrypted Cloudflare Worker secrets and cannot be viewed here.
            </p>
          </div>
        </div>

        {/* Timezone */}
        <div className="block-section px-5 py-5">
          <h3 className="text-[13px] font-medium text-neutral-800 mb-4">Display</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-neutral-700">Timezone</p>
              <p className="text-[11px] text-neutral-400 mt-0.5">Used for displaying dates and times</p>
            </div>
            <span className="text-[13px] text-neutral-600">GMT+7 (Asia/Ho_Chi_Minh)</span>
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[13px] px-4 py-1.5 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          {saved && (
            <span className="text-[12px] text-green-600">Settings saved</span>
          )}
        </div>
      </div>
    </>
  );
}
