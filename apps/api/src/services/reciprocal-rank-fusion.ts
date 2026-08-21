/**
 * Reciprocal Rank Fusion for merging ranked result lists.
 *
 * Kept free of DB/network imports so it can be unit tested in isolation.
 *
 * Fusing on *rank* rather than score is the point: cosine similarity, ts_rank
 * and BM25 aren't on comparable scales, so their scores can't simply be added.
 */

/** Rank-damping constant. 60 is the value the memory recall path was tuned with. */
export const RRF_K = 60;

/**
 * Merge ranked lists into one.
 *
 * When the same id appears in several lists, the row from the *earliest* list
 * is the one returned — order lists so the richest representation comes first
 * (e.g. semantic before lexical, since its similarity score is the meaningful
 * one).
 */
export function fuseByRRF<T>(
  lists: T[][],
  idOf: (row: T) => string,
  limit: number,
  k: number = RRF_K,
): T[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, T>();

  for (const list of lists) {
    for (const [rank, row] of list.entries()) {
      const id = idOf(row);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
      if (!byId.has(id)) byId.set(id, row);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id) as T);
}
