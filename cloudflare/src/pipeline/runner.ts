import { Env, SourceRow, NormalizedItem, WATCH_ONLY } from '../types';
import { getConnector } from '../connectors/index';
import { normalizeItem } from './normalize';
import { dedupeItems } from './dedupe';
import { applyTags } from './tagger';
import { scoreItems } from './scorer';
import {
  getKeywords, getGoals, insertContentItem,
  updateSourceCursor, createRunLog, finishRunLog, dbRun,
} from '../db';
import { jsonParse } from '../db';

function uuid() { return crypto.randomUUID(); }

export interface PipelineResult {
  status: 'success' | 'error' | 'skipped';
  itemsFetched?: number;
  totalFetched?: number;
  duplicates?: number;
  filtered?: number;
  gated?: number;    // items dropped by quality gate (no URL or no content)
  reason?: string;
  error?: string;
}

/** Minimum bar: item must have a URL and at least a title or text body */
function passesQualityGate(item: NormalizedItem): boolean {
  if (!item.url) return false;
  if (!item.text_content && !item.title) return false;
  return true;
}

export async function runSourcePipeline(
  source: SourceRow,
  env: Env,
): Promise<PipelineResult> {
  if (!source.is_active) return { status: 'skipped', reason: 'inactive' };
  if (WATCH_ONLY.has(source.connector_type)) return { status: 'skipped', reason: 'watch_only' };

  const config = jsonParse<Record<string, unknown>>(source.config, {});
  const lookbackDays = config.lookback_days ? Number(config.lookback_days) : null;
  const lookbackMs = lookbackDays ? lookbackDays * 86_400_000 : null;
  const cutoffTime = lookbackMs ? Date.now() - lookbackMs : null;

  const runId = uuid();
  await createRunLog(env, runId, source.id);

  try {
    // 1. Fetch
    const connector = getConnector(source, env);
    const { rawItems, newCursor } = await connector.fetch(source.last_cursor ?? null);

    // Always update last_fetched_at regardless of item count
    await dbRun(env,
      "UPDATE sources SET last_fetched_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      source.id,
    );

    if (!rawItems.length) {
      // Still advance cursor so we don't re-fetch the same empty batch
      if (newCursor) await updateSourceCursor(env, source.id, newCursor);
      await finishRunLog(env, runId, 'success', 0);
      return { status: 'success', itemsFetched: 0, totalFetched: 0, duplicates: 0, filtered: 0 };
    }

    // 2. Normalize
    const normalized = await Promise.all(rawItems.map((r) => normalizeItem(r, source)));

    // 3. Lookback filter — drop items older than cutoff
    let filtered = 0;
    const withinWindow = cutoffTime
      ? normalized.filter((item) => {
          if (!item.publish_time) return true; // no date → keep
          const publishMs = new Date(item.publish_time).getTime();
          if (isNaN(publishMs)) return true;
          if (publishMs < cutoffTime) { filtered++; return false; }
          return true;
        })
      : normalized;

    if (!withinWindow.length) {
      // Always advance cursor even when all items were filtered
      if (newCursor) await updateSourceCursor(env, source.id, newCursor);
      await finishRunLog(env, runId, 'success', 0);
      return { status: 'success', itemsFetched: 0, totalFetched: rawItems.length, duplicates: 0, filtered };
    }

    // 4. Dedupe
    const deduped = await dedupeItems(withinWindow, env);

    // 5. Tag
    const keywords = await getKeywords(env, true);
    const tagged = applyTags(deduped, keywords as never);

    // 6. Score
    const goals = await getGoals(env, true);
    const scored = scoreItems(tagged, goals as never);

    // 7. Store — only insert new (non-duplicate) items that pass quality gate
    const nonDupes = scored.filter((i) => !i.is_duplicate);
    const newItems = nonDupes.filter(passesQualityGate);
    const gated = nonDupes.length - newItems.length;

    for (const item of newItems) {
      await insertContentItem(env, {
        ...item,
        is_duplicate: 0,
      });
    }

    // 8. Update cursor
    if (newCursor) await updateSourceCursor(env, source.id, newCursor);

    const duplicates = scored.length - nonDupes.length;
    await finishRunLog(env, runId, 'success', newItems.length);

    return { status: 'success', itemsFetched: newItems.length, totalFetched: rawItems.length, duplicates, filtered, gated };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishRunLog(env, runId, 'error', 0, msg);
    return { status: 'error', error: msg };
  }
}
