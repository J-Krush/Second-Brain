export const RRF_K = 60;

/**
 * Reciprocal rank fusion: merge ranked lists by summing 1/(k + rank + 1) for
 * each item across lists (rank is 0-based position). Rewards items ranked well
 * by multiple retrievers without needing comparable raw scores. Returns items
 * (deduped by id) sorted by fused score, each item's `score` overwritten.
 */
export function reciprocalRankFusion<T extends { id: string; score: number }>(
  lists: T[][],
  k = RRF_K,
): T[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, T>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      byId.set(item.id, item);
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ ...byId.get(id)!, score }));
}
