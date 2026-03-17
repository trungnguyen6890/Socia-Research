import { NormalizedItem, KeywordRow } from '../types';

export function applyTags(items: NormalizedItem[], keywords: KeywordRow[]): NormalizedItem[] {
  if (!keywords.length) return items;

  const compiledKeywords = keywords.map((kw) => ({
    kw,
    pattern: kw.match_mode === 'regex' ? safeRegex(kw.keyword) : null,
  }));

  for (const item of items) {
    const text = `${item.title ?? ''} ${item.text_content ?? ''}`.toLowerCase();
    const matched = new Set<string>(JSON.parse(item.tags));

    for (const { kw, pattern } of compiledKeywords) {
      if (kw.match_mode === 'exact' && kw.keyword.toLowerCase() === text.trim()) {
        matched.add(kw.category);
      } else if (kw.match_mode === 'contains' && text.includes(kw.keyword.toLowerCase())) {
        matched.add(kw.category);
      } else if (kw.match_mode === 'regex' && pattern?.test(text)) {
        matched.add(kw.category);
      }
    }

    item.tags = JSON.stringify([...matched].sort());
  }

  return items;
}

function safeRegex(pattern: string): RegExp | null {
  try { return new RegExp(pattern, 'i'); } catch { return null; }
}
