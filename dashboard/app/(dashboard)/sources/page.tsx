'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSources, runSource, toggleSource, deleteSource, updateSource, createSource, detectSource } from '@/lib/api';
import { fmtDate, fmtRelative, jsonSafe, CONNECTOR_COLORS, cn } from '@/lib/utils';
import { parseSourcesFromText, CONNECTOR_LABEL } from '@/lib/source-parser';
import type { ParsedSource } from '@/lib/source-parser';
import type { Source } from '@/lib/types';
import type { RunResult } from '@/lib/api';
import PageHeader from '@/components/page-header';
import Badge from '@/components/badge';
import EmptyState from '@/components/empty-state';
import { useToast } from '@/components/toast';
import Link from 'next/link';

const CONNECTOR_TYPES = [
  'rss', 'website', 'youtube', 'x_browser', 'telegram',
  'facebook_page', 'facebook_browser', 'instagram_pro', 'tiktok_watch', 'threads_watch',
];
const SOURCE_MODES = ['official_api', 'rss', 'website_parse', 'manual_watch', 'provider_api'];

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [runResults, setRunResults] = useState<Record<string, RunResult>>({});
  const [modalSource, setModalSource] = useState<Source | 'new' | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const { toast } = useToast();

  const reload = () => getSources().then(setSources);
  useEffect(() => { reload(); }, []);

  const handleRun = async (e: React.MouseEvent, sourceId: string) => {
    e.stopPropagation();
    setRunning(prev => ({ ...prev, [sourceId]: true }));
    setRunResults(prev => { const n = { ...prev }; delete n[sourceId]; return n; });
    try {
      const result = await runSource(sourceId);
      setRunResults(prev => ({ ...prev, [sourceId]: result }));
      if (result.status === 'error') {
        toast(result.error ?? 'Run failed', 'error');
      } else if (result.status === 'skipped') {
        toast(`Skipped: ${result.reason ?? 'unknown'}`, 'info');
      } else {
        const msg = `+${result.itemsFetched ?? 0} new items` +
          (result.duplicates ? `, ${result.duplicates} duplicates` : '') +
          (result.filtered ? `, ${result.filtered} filtered` : '');
        toast(msg, 'success');
      }
      reload();
    } catch (err) {
      toast(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      setRunResults(prev => ({ ...prev, [sourceId]: { status: 'error', error: 'Network error' } }));
    } finally {
      setRunning(prev => ({ ...prev, [sourceId]: false }));
    }
  };

  const handleToggle = async (e: React.MouseEvent, s: Source) => {
    e.stopPropagation();
    try {
      const result = await toggleSource(s.id);
      toast(`${s.name} ${result.is_active ? 'enabled' : 'disabled'}`, 'success');
      reload();
    } catch (err) {
      toast(`Failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleDelete = async (e: React.MouseEvent, s: Source) => {
    e.stopPropagation();
    if (!confirm(`Delete source "${s.name}" and all its content?`)) return;
    try {
      await deleteSource(s.id);
      toast(`${s.name} deleted`, 'success');
      setExpanded(null);
      reload();
    } catch (err) {
      toast(`Failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const getRunLabel = (id: string) => {
    if (running[id]) return 'Running…';
    const r = runResults[id];
    if (!r) return '▶ Run';
    if (r.status === 'error') return '⚠ Error';
    if (r.status === 'skipped') return '— Skipped';
    return `✓ +${r.itemsFetched ?? 0}`;
  };

  const getRunClass = (id: string) => {
    const base = 'text-[11px] px-2.5 py-1 rounded border transition-colors';
    if (running[id]) return `${base} border-neutral-300 text-neutral-400 bg-neutral-50`;
    const r = runResults[id];
    if (!r) return `${base} border-neutral-200 text-neutral-500 hover:bg-neutral-50`;
    if (r.status === 'error') return `${base} border-red-200 text-red-500 bg-red-50`;
    if (r.status === 'skipped') return `${base} border-neutral-200 text-neutral-400`;
    return `${base} border-green-200 text-green-600 bg-green-50`;
  };

  return (
    <>
      <PageHeader
        title="Sources"
        description={`${sources.length} source${sources.length !== 1 ? 's' : ''} configured`}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBulk(true)}
              className="text-[13px] px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              + Bulk add
            </button>
            <button
              onClick={() => setModalSource('new')}
              className="text-[13px] px-3 py-1.5 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 transition-colors"
            >
              + Add source
            </button>
          </div>
        }
      />

      {sources.length === 0 ? (
        <EmptyState message="No sources yet" description="Add your first content source to get started" />
      ) : (
        <div className="block-section">
          <table className="notion-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Mode</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Last fetched</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const tags: string[] = jsonSafe(s.tags, []);
                const isExpanded = expanded === s.id;
                let configPretty = s.config;
                try { configPretty = JSON.stringify(JSON.parse(s.config), null, 2); } catch {}

                return (
                  <SourceRows
                    key={s.id}
                    s={s}
                    tags={tags}
                    configPretty={configPretty}
                    isExpanded={isExpanded}
                    onToggleExpand={() => setExpanded(isExpanded ? null : s.id)}
                    onRun={(e) => handleRun(e, s.id)}
                    onToggle={(e) => handleToggle(e, s)}
                    onDelete={(e) => handleDelete(e, s)}
                    onEdit={(e) => { e.stopPropagation(); setModalSource(s); }}
                    runLabel={getRunLabel(s.id)}
                    runClass={getRunClass(s.id)}
                    isRunning={!!running[s.id]}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalSource && (
        <SourceModal
          source={modalSource === 'new' ? null : modalSource}
          onClose={() => setModalSource(null)}
          onSaved={(isNew) => {
            setModalSource(null);
            reload();
            toast(isNew ? 'Source created' : 'Source updated', 'success');
          }}
          onError={(msg) => toast(msg, 'error')}
        />
      )}

      {showBulk && (
        <BulkAddModal
          onClose={() => setShowBulk(false)}
          onSaved={(count) => {
            setShowBulk(false);
            reload();
            toast(`${count} source${count !== 1 ? 's' : ''} added`, 'success');
          }}
          onError={(msg) => toast(msg, 'error')}
        />
      )}
    </>
  );
}

// ─── Source table rows ─────────────────────────────────────────────────────

function SourceRows({
  s, tags, configPretty, isExpanded, onToggleExpand,
  onRun, onToggle, onDelete, onEdit,
  runLabel, runClass, isRunning,
}: {
  s: Source;
  tags: string[];
  configPretty: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRun: (e: React.MouseEvent) => void;
  onToggle: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onEdit: (e: React.MouseEvent) => void;
  runLabel: string;
  runClass: string;
  isRunning: boolean;
}) {
  return (
    <>
      <tr className="cursor-pointer" onClick={onToggleExpand}>
        <td>
          <div className="font-medium text-neutral-700">{s.name}</div>
          <div className="text-[11px] text-neutral-400 mt-0.5 truncate max-w-[200px]">{s.url_or_handle}</div>
        </td>
        <td><Badge className={cn(CONNECTOR_COLORS[s.connector_type])}>{s.connector_type}</Badge></td>
        <td><Badge variant="muted">{s.source_mode}</Badge></td>
        <td className="text-neutral-500 tabular-nums">{s.priority}</td>
        <td><Badge variant={s.is_active ? 'success' : 'muted'}>{s.is_active ? 'active' : 'inactive'}</Badge></td>
        <td className="text-[12px] text-neutral-400">{fmtRelative(s.last_fetched_at)}</td>
        <td>
          <button onClick={onRun} disabled={isRunning} className={runClass}>
            {runLabel}
          </button>
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={7} className="!bg-neutral-50/70 !py-4 !px-6">
            <div className="grid grid-cols-2 gap-6 text-[13px]">
              <div>
                <div className="text-[11px] text-neutral-400 uppercase tracking-wider mb-2">Configuration</div>
                <pre className="text-[12px] text-neutral-600 bg-white border border-neutral-200 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                  {configPretty}
                </pre>
              </div>
              <div>
                <div className="text-[11px] text-neutral-400 uppercase tracking-wider mb-2">Details</div>
                <div className="space-y-1.5 text-[12px]">
                  <p><span className="text-neutral-400">Created:</span> <span className="text-neutral-600">{fmtDate(s.created_at)}</span></p>
                  <p><span className="text-neutral-400">Last cursor:</span> <span className="text-neutral-600">{s.last_cursor ?? '—'}</span></p>
                  {tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap items-center">
                      <span className="text-neutral-400">Tags:</span>
                      {tags.map(t => (
                        <span key={t} className="text-[10px] text-neutral-500 bg-white border border-neutral-200 px-1.5 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  <Link
                    href={`/content?source_id=${s.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] px-2.5 py-1 rounded border border-neutral-200 text-neutral-500 hover:bg-white transition-colors"
                  >
                    Content
                  </Link>
                  <button onClick={onEdit} className="text-[11px] px-2.5 py-1 rounded border border-neutral-200 text-neutral-500 hover:bg-white transition-colors">
                    Edit
                  </button>
                  <button onClick={onToggle} className="text-[11px] px-2.5 py-1 rounded border border-neutral-200 text-neutral-500 hover:bg-white transition-colors">
                    {s.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={onDelete} className="text-[11px] px-2.5 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Bulk Add Modal ────────────────────────────────────────────────────────

function BulkAddModal({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: (count: number) => void;
  onError: (msg: string) => void;
}) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedSource[]>([]);
  const [edits, setEdits] = useState<Record<number, Partial<ParsedSource>>>({});
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [failedLines, setFailedLines] = useState<string[]>([]);
  const [probing, setProbing] = useState<Set<number>>(new Set());

  const handleParse = useCallback(async () => {
    const lines = text
      .split(/[\n,]+/)
      .map((l) => l.trim())
      .filter(Boolean);

    const results = parseSourcesFromText(text);
    const parsedInputs = new Set(results.map((r) => r.raw_input));
    const failed = lines.filter((l) => !parsedInputs.has(l));

    setParsed(results);
    setEdits({});
    setFailedLines(failed);
    setStep('preview');

    // For URLs that fell back to "website", probe the server for RSS detection
    const websiteIdxs = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.connector_type === 'website');

    if (websiteIdxs.length === 0) return;

    setProbing(new Set(websiteIdxs.map(({ i }) => i)));

    await Promise.all(
      websiteIdxs.map(async ({ r, i }) => {
        try {
          const detected = await detectSource(r.raw_input);
          // Only upgrade if server found something better than "website"
          if (detected.connector_type !== 'website' || detected.confidence !== 'low') {
            setParsed(prev => prev.map((item, idx) =>
              idx === i
                ? {
                    ...item,
                    connector_type: detected.connector_type,
                    url_or_handle: detected.url_or_handle,
                    source_mode: detected.source_mode,
                    confidence: detected.confidence,
                  }
                : item
            ));
          }
        } catch {
          // Keep original client-side result on error
        } finally {
          setProbing(prev => { const next = new Set(prev); next.delete(i); return next; });
        }
      })
    );
  }, [text]);

  const getRow = (i: number): ParsedSource => ({ ...parsed[i], ...edits[i] });

  const updateEdit = (i: number, field: keyof ParsedSource, value: string) => {
    setEdits(prev => ({ ...prev, [i]: { ...prev[i], [field]: value } }));
  };

  const removeRow = (i: number) => {
    setParsed(prev => prev.filter((_, idx) => idx !== i));
    setEdits(prev => {
      const next: Record<number, Partial<ParsedSource>> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (parsed.length === 0) return;
    setSaving(true);
    let ok = 0;
    const errors: string[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const row = getRow(i);
      try {
        await createSource({
          name: row.name,
          connector_type: row.connector_type,
          source_mode: row.source_mode,
          url_or_handle: row.url_or_handle,
          config: '{}',
          tags: '[]',
          priority: 5,
        });
        ok++;
      } catch (err) {
        errors.push(`${row.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setSaving(false);
    if (errors.length > 0) onError(errors.join('; '));
    if (ok > 0) onSaved(ok);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={onClose}>
      <div
        className="bg-white border border-neutral-200 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-[14px] font-semibold text-neutral-900">Bulk add sources</h2>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {step === 'input'
                ? 'Paste URLs or handles — one per line. Connector type is auto-detected.'
                : `${parsed.length} source${parsed.length !== 1 ? 's' : ''} detected — review before saving`}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 text-lg leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'input' ? (
            <div className="space-y-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                autoFocus
                className="w-full text-[13px] px-3 py-2.5 border border-neutral-200 rounded-md focus:outline-none focus:border-neutral-400 font-mono resize-none"
                placeholder={`https://x.com/username\nhttps://youtube.com/@channel\nhttps://facebook.com/pagename\nhttps://t.me/channel\nhttps://vnexpress.net/rss/tin-moi-nhat.rss\nhttps://example.com`}
              />
              <p className="text-[11px] text-neutral-400">
                Supported: X/Twitter, YouTube, Facebook Page, Instagram, TikTok, Telegram, Threads, RSS feeds, Websites
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {parsed.length === 0 ? (
                <p className="text-[13px] text-neutral-400">No sources could be detected from the input.</p>
              ) : (
                <div className="space-y-2">
                  {parsed.map((_, i) => {
                    const row = getRow(i);
                    const isProbing = probing.has(i);
                    return (
                      <div key={i} className={cn('border rounded-md p-3 space-y-2.5', isProbing ? 'border-neutral-200 opacity-70' : 'border-neutral-200')}>
                        <div className="flex items-start gap-2">
                          {isProbing ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 mt-0.5 bg-neutral-100 text-neutral-400 animate-pulse">
                              Detecting…
                            </span>
                          ) : (
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 mt-0.5',
                            CONNECTOR_COLORS[row.connector_type] ?? 'bg-neutral-100 text-neutral-600'
                          )}>
                            {CONNECTOR_LABEL[row.connector_type] ?? row.connector_type}
                          </span>
                          )}
                          <span className="text-[11px] text-neutral-400 truncate flex-1">{row.raw_input}</span>
                          <button
                            onClick={() => removeRow(i)}
                            className="text-[11px] text-red-400 hover:text-red-600 shrink-0"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-neutral-400 block mb-0.5">Name</label>
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => updateEdit(i, 'name', e.target.value)}
                              className="w-full text-[12px] px-2 py-1 border border-neutral-200 rounded focus:outline-none focus:border-neutral-400"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-neutral-400 block mb-0.5">Connector</label>
                            <select
                              value={row.connector_type}
                              onChange={(e) => updateEdit(i, 'connector_type', e.target.value)}
                              className="w-full text-[12px] px-2 py-1 border border-neutral-200 rounded focus:outline-none focus:border-neutral-400 bg-white"
                            >
                              {CONNECTOR_TYPES.map(ct => <option key={ct} value={ct}>{ct}</option>)}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className="text-[11px] text-neutral-400 block mb-0.5">URL / Handle</label>
                            <input
                              type="text"
                              value={row.url_or_handle}
                              onChange={(e) => updateEdit(i, 'url_or_handle', e.target.value)}
                              className="w-full text-[12px] px-2 py-1 border border-neutral-200 rounded focus:outline-none focus:border-neutral-400 font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {failedLines.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
                  <p className="text-[11px] text-amber-700 font-medium mb-1">Could not detect connector for:</p>
                  {failedLines.map((l, i) => (
                    <p key={i} className="text-[11px] text-amber-600 font-mono">{l}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-100 flex items-center justify-between shrink-0">
          {step === 'preview' ? (
            <>
              <button
                onClick={() => setStep('input')}
                className="text-[13px] text-neutral-500 hover:text-neutral-700"
              >
                ← Back
              </button>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="text-[13px] px-4 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || parsed.length === 0}
                  className="text-[13px] px-4 py-1.5 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Adding…' : `Add ${parsed.length} source${parsed.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          ) : (
            <>
              <span />
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="text-[13px] px-4 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => { void handleParse(); }}
                  disabled={!text.trim()}
                  className="text-[13px] px-4 py-1.5 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors"
                >
                  Parse →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Create / Edit Source Modal ────────────────────────────────────────────

function SourceModal({
  source,
  onClose,
  onSaved,
  onError,
}: {
  source: Source | null;
  onClose: () => void;
  onSaved: (isNew: boolean) => void;
  onError: (msg: string) => void;
}) {
  const isNew = !source;
  const [name, setName] = useState(source?.name ?? '');
  const [connectorType, setConnectorType] = useState(source?.connector_type ?? 'rss');
  const [sourceMode, setSourceMode] = useState(source?.source_mode ?? 'rss');
  const [urlOrHandle, setUrlOrHandle] = useState(source?.url_or_handle ?? '');
  const [config, setConfig] = useState(() => {
    if (!source?.config) return '{}';
    try { return JSON.stringify(JSON.parse(source.config), null, 2); } catch { return source.config; }
  });
  const [tagsStr, setTagsStr] = useState(() => {
    if (!source?.tags) return '';
    try { return (JSON.parse(source.tags) as string[]).join(', '); } catch { return ''; }
  });
  const [priority, setPriority] = useState(source?.priority ?? 5);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { onError('Name is required'); return; }

    let configJson = '{}';
    try { JSON.parse(config); configJson = config; } catch {
      onError('Invalid JSON in config field');
      return;
    }
    const tags = JSON.stringify(tagsStr.split(',').map(s => s.trim()).filter(Boolean));

    setSaving(true);
    try {
      if (isNew) {
        await createSource({
          name,
          connector_type: connectorType,
          source_mode: sourceMode,
          url_or_handle: urlOrHandle,
          config: configJson,
          tags,
          priority,
        });
      } else {
        await updateSource(source.id, {
          name,
          connector_type: connectorType,
          source_mode: sourceMode,
          url_or_handle: urlOrHandle,
          config: configJson,
          tags,
          priority,
        });
      }
      onSaved(isNew);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={onClose}>
      <div
        className="bg-white border border-neutral-200 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-neutral-900">{isNew ? 'Add Source' : 'Edit Source'}</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 text-lg leading-none">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <Field label="Name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="form-input" placeholder="e.g. VnExpress Tech" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Connector type">
              <select value={connectorType} onChange={(e) => setConnectorType(e.target.value)} className="form-input">
                {CONNECTOR_TYPES.map(ct => <option key={ct} value={ct}>{ct}</option>)}
              </select>
            </Field>
            <Field label="Source mode">
              <select value={sourceMode} onChange={(e) => setSourceMode(e.target.value)} className="form-input">
                {SOURCE_MODES.map(sm => <option key={sm} value={sm}>{sm}</option>)}
              </select>
            </Field>
          </div>

          <Field label="URL or Handle">
            <input type="text" value={urlOrHandle} onChange={(e) => setUrlOrHandle(e.target.value)} className="form-input" placeholder="Feed URL, channel ID, username…" />
          </Field>

          <Field label="Config (JSON)">
            <textarea
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              rows={4}
              className="form-input font-mono text-[12px]"
              placeholder='{"lookback_days": 3}'
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Tags (comma-separated)">
              <input type="text" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} className="form-input" placeholder="tech, news" />
            </Field>
            <Field label="Priority (1=high, 10=low)">
              <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} min={1} max={10} className="form-input" />
            </Field>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-[13px] px-4 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[13px] px-4 py-1.5 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] text-neutral-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}
