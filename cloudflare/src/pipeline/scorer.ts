import { NormalizedItem, GoalRow } from '../types';

export function scoreItems(items: NormalizedItem[], goals: GoalRow[]): NormalizedItem[] {
  const goalCategories = goals.map((g) =>
    new Set((g.keywords ?? []).map((k) => k.category))
  );

  for (const item of items) {
    item.quality_score = qualityScore(item);
    item.signal_score = signalScore(item, goalCategories);
  }

  return items;
}

function qualityScore(item: NormalizedItem): number {
  let score = 0;
  const text = item.text_content ?? '';
  const eng = item.engagement_snapshot ? JSON.parse(item.engagement_snapshot) : null;

  if (text.length > 10) score += 0.2;
  if (text.length > 100) score += 0.15;
  if (item.title) score += 0.15;
  if (eng && Object.values(eng).some((v) => typeof v === 'number' && v > 0)) score += 0.2;
  if (item.publish_time) {
    const age = Date.now() - new Date(item.publish_time).getTime();
    if (age < 86_400_000) score += 0.15; // < 24h
  }
  if (!item.is_duplicate) score += 0.15;

  return Math.round(Math.min(score, 1) * 1000) / 1000;
}

function signalScore(item: NormalizedItem, goalCategories: Set<string>[]): number {
  if (!goalCategories.length) return 0.1;

  const tags = new Set<string>(JSON.parse(item.tags));
  if (!tags.size) return 0.1;

  const matches = goalCategories.filter((cats) =>
    [...tags].some((t) => cats.has(t))
  ).length;

  if (matches === 0) return 0.1;
  const max = goalCategories.length;
  return Math.round(Math.min(0.4 + 0.6 * (matches - 1) / Math.max(max - 1, 1), 1) * 1000) / 1000;
}
