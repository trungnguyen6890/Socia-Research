import { NormalizedItem } from '../types';
import { findDuplicates } from '../db';
import { Env } from '../types';

export async function dedupeItems(items: NormalizedItem[], env: Env): Promise<NormalizedItem[]> {
  if (!items.length) return items;

  const urls = items.map((i) => i.url).filter(Boolean);
  const hashes = items.map((i) => i.content_hash).filter((h): h is string => !!h);

  const { byUrl, byHash } = await findDuplicates(env, urls, hashes);

  const urlToId = new Map<string, string>();
  for (const row of byUrl) {
    urlToId.set(row.url, row.id);
    if (row.canonical_url) urlToId.set(row.canonical_url, row.id);
  }
  const hashToId = new Map<string, string>();
  for (const row of byHash) hashToId.set(row.content_hash, row.id);

  // Within-batch dedup
  const seenUrls = new Map<string, number>();
  const seenHashes = new Map<string, number>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const url = item.url;
    const canonical = item.canonical_url ?? url;
    const hash = item.content_hash;

    // Check DB
    const dupId = urlToId.get(url) ?? urlToId.get(canonical) ?? (hash ? hashToId.get(hash) : undefined);
    if (dupId) {
      item.is_duplicate = true;
      item.duplicate_of_id = dupId;
      continue;
    }

    // Check within batch
    if (url && seenUrls.has(url)) { item.is_duplicate = true; continue; }
    if (hash && seenHashes.has(hash)) { item.is_duplicate = true; continue; }

    if (url) seenUrls.set(url, i);
    if (canonical && canonical !== url) seenUrls.set(canonical, i);
    if (hash) seenHashes.set(hash, i);
  }

  return items;
}
