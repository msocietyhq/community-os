/**
 * Pure ranking helpers for memory recall.
 *
 * Kept free of DB/network imports so it can be unit tested in isolation.
 */

/**
 * Absolute cosine-similarity floor applied in SQL.
 *
 * Measured against the live corpus with voyage-3-lite: relevant query/memory
 * pairs land in the 0.40–0.65 band (e.g. "who is organising the next event"
 * → "Ashiqurrah is responsible for planning the next meetup" scores 0.544).
 * The previous 0.6 floor discarded almost every true positive, so this exists
 * only to drop obvious noise — relevance is decided by `applyRelativeCutoff`.
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
