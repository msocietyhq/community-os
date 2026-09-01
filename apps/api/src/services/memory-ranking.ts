/**
 * Pure ranking helpers for memory recall.
 *
 * Kept free of DB/network imports so it can be unit tested in isolation.
 */

/**
 * @deprecated Superseded by `recall-calibration.getSimilarityFloor()`, which
 * derives the floor from the corpus's own noise distribution.
 *
 * Kept only so callers passing an explicit `minSimilarity` have a documented
 * reference point. Measuring production showed a hand-picked absolute floor is
 * close to meaningless here: two *unrelated* memories average 0.345, so this
 * value sat at the median of the noise. See `recall-calibration.ts`.
 */
export const MIN_SIMILARITY_FLOOR = 0.35;

/**
 * How far below the best match a memory may score and still be included.
 * Keeps the result set to the cluster around the top hit rather than padding
 * it out to `limit` with weak matches.
 */
export const DEFAULT_RELATIVE_CUTOFF = 0.15;

interface Scored {
  similarity: number;
}

/**
 * Keeps only the memories scoring within `cutoff` of the best match.
 *
 * Absolute thresholds don't transfer across embedding models or corpora;
 * the gap to the top hit does. Input need not be pre-sorted — the result is
 * always ordered by similarity, highest first.
 */
export function applyRelativeCutoff<T extends Scored>(
  memories: T[],
  cutoff: number = DEFAULT_RELATIVE_CUTOFF,
): T[] {
  if (memories.length === 0) return [];

  const sorted = [...memories].sort((a, b) => b.similarity - a.similarity);
  const top = sorted[0]!.similarity;

  return sorted.filter((m) => m.similarity >= top - cutoff);
}

/**
 * Days after which a memory's weight halves. Long enough that a durable fact
 * ("works at Stripe") still outranks a fresh throwaway one, short enough that
 * a year-old claim yields to a recent correction.
 */
export const RECENCY_HALF_LIFE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

interface Dated {
  confidence: number;
  createdAt: Date;
}

/**
 * Score combining how sure we were with how long ago we learned it.
 *
 * Sorting subject memories by recency alone hides durable high-confidence
 * facts behind recent trivia; sorting by confidence alone never lets a
 * correction win. This decays confidence rather than replacing it.
 */
export function memoryWeight(memory: Dated, now: Date): number {
  const ageDays = Math.max(
    0,
    (now.getTime() - memory.createdAt.getTime()) / DAY_MS,
  );
  return memory.confidence * 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Ranks memories by `memoryWeight`, highest first, and keeps the top `limit`.
 * Ties fall back to newest-first so ordering is deterministic.
 */
export function rankByConfidenceAndRecency<T extends Dated>(
  memories: T[],
  now: Date,
  limit: number,
): T[] {
  return [...memories]
    .sort((a, b) => {
      const diff = memoryWeight(b, now) - memoryWeight(a, now);
      if (diff !== 0) return diff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, limit);
}
