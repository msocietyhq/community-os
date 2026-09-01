import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Derives the recall similarity floor from the corpus itself.
 *
 * An absolute floor is close to meaningless in this embedding space. Measured
 * on production: two *random, unrelated* memories score 0.345 on average, so a
 * hand-picked 0.35 sits at the median of the noise and filters nothing. The
 * corpus is short English text about one community in one domain, so nothing
 * is truly orthogonal and the whole distribution is shifted up.
 *
 * What is stable is the *shape*: noise p90 ≈ 0.47 against a true-nearest-
 * neighbour p10 ≈ 0.575, so there is a real gap to place a threshold in. This
 * measures that gap rather than guessing at it.
 *
 * Similarity between two texts does not change as the corpus grows — adding
 * memories never moves an existing pair's score. What moves the noise floor is
 * a change in the corpus's *character*: broader topics, another language, a
 * different embedding model. Those are exactly the changes nobody remembers to
 * recalibrate for, which is why this runs on its own.
 */

/**
 * Percentile of the noise distribution to place the floor at.
 *
 * p90 sits in the gap between the two distributions. p99 (≈0.59) would land
 * above the true-match p10 (≈0.575) and start cutting real recalls.
 */
export const NOISE_PERCENTILE = 0.9;

/** Used until a measurement lands. Production noise p90, measured 2026-08. */
export const FALLBACK_SIMILARITY_FLOOR = 0.47;

/** Below this the sampled null distribution isn't trustworthy. */
export const MIN_MEMORIES_TO_CALIBRATE = 50;

/** Memories sampled; pairs compared is roughly n²/2. */
export const CALIBRATION_SAMPLE_SIZE = 200;

/** A measurement older than this is refreshed on the next recall. */
export const CALIBRATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A derived floor outside this range means something is wrong with the corpus
 * or the model, not that the threshold should be extreme.
 */
export const FLOOR_MIN = 0.2;
export const FLOOR_MAX = 0.75;

export interface NoiseProfile {
  pairsCompared: number;
  mean: number;
  p50: number;
  p90: number;
  p99: number;
  /** Epoch ms. */
  measuredAt: number;
}

/**
 * Turns a measured noise profile into a usable floor.
 *
 * Pure: the clamp is the only judgement, and it exists so a pathological
 * measurement degrades to the known-good default instead of disabling recall
 * or letting everything through.
 */
export function deriveFloor(
  profile: Pick<NoiseProfile, "p90"> | null,
  fallback: number = FALLBACK_SIMILARITY_FLOOR,
): number {
  if (!profile) return fallback;
  if (!Number.isFinite(profile.p90)) return fallback;
  if (profile.p90 < FLOOR_MIN || profile.p90 > FLOOR_MAX) return fallback;
  return profile.p90;
}

/** True when the profile is missing or stale enough to re-measure. */
export function needsCalibration(
  profile: NoiseProfile | null,
  now: number,
  ttlMs: number = CALIBRATION_TTL_MS,
): boolean {
  if (!profile) return true;
  return now - profile.measuredAt >= ttlMs;
}

let cached: NoiseProfile | null = null;
let inFlight: Promise<NoiseProfile | null> | null = null;

/**
 * Samples random memory pairs and measures how similar unrelated text is.
 *
 * Pure SQL over vectors already stored — no embedding calls, no API cost.
 */
export async function measureNoiseFloor(
  sampleSize: number = CALIBRATION_SAMPLE_SIZE,
): Promise<NoiseProfile | null> {
  const rows = (await db.execute(sql`
    with s as (
      select row_number() over () as rn, embedding
      from bot_memories
      where superseded_by is null and embedding is not null
      order by random() limit ${sampleSize}
    ), pairs as (
      select 1 - (a.embedding <=> b.embedding) as sim
      from s a join s b on a.rn < b.rn
    )
    select
      count(*)::int as pairs_compared,
      avg(sim)::float8 as mean,
      percentile_cont(0.50) within group (order by sim)::float8 as p50,
      percentile_cont(0.90) within group (order by sim)::float8 as p90,
      percentile_cont(0.99) within group (order by sim)::float8 as p99
    from pairs
  `)) as unknown as Array<{
    pairs_compared: number;
    mean: number | null;
    p50: number | null;
    p90: number | null;
    p99: number | null;
  }>;

  const row = rows[0];
  if (!row || row.p90 === null || row.pairs_compared === 0) return null;

  return {
    pairsCompared: row.pairs_compared,
    mean: row.mean ?? 0,
    p50: row.p50 ?? 0,
    p90: row.p90,
    p99: row.p99 ?? 0,
    measuredAt: Date.now(),
  };
}

/**
 * Measures and caches the noise profile. Safe to call on every boot; failures
 * leave the previous profile (or the fallback) in place rather than throwing.
 */
export async function calibrateRecall(): Promise<NoiseProfile | null> {
  // Collapse concurrent callers onto one measurement.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const countRows = (await db.execute(sql`
        select count(*)::int as count from bot_memories
        where superseded_by is null and embedding is not null
      `)) as unknown as Array<{ count: number }>;
      const count = countRows[0]?.count ?? 0;

      if (count < MIN_MEMORIES_TO_CALIBRATE) {
        console.log(
          `[recall-calibration] ${count} memories — too few to calibrate, using ${FALLBACK_SIMILARITY_FLOOR}`,
        );
        return cached;
      }

      const profile = await measureNoiseFloor();
      if (!profile) return cached;

      cached = profile;
      const floor = deriveFloor(profile);
      console.log(
        `[recall-calibration] ${profile.pairsCompared} pairs — noise mean ${profile.mean.toFixed(3)}, ` +
          `p90 ${profile.p90.toFixed(3)}, p99 ${profile.p99.toFixed(3)} → floor ${floor.toFixed(3)}` +
          (floor === FALLBACK_SIMILARITY_FLOOR && profile.p90 !== floor
            ? " (clamped to fallback)"
            : ""),
      );
      return profile;
    } catch (err) {
      console.error(
        "[recall-calibration] failed, keeping previous floor:",
        err,
      );
      return cached;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * The floor to use right now. Never blocks: if the cached profile is stale a
 * refresh is kicked off in the background and the current value is returned.
 */
export function getSimilarityFloor(now: number = Date.now()): number {
  if (needsCalibration(cached, now)) {
    void calibrateRecall();
  }
  return deriveFloor(cached);
}

/** Current profile, for diagnostics. */
export function currentNoiseProfile(): NoiseProfile | null {
  return cached;
}

/** Test seam — module-level cache. */
export function resetCalibration(): void {
  cached = null;
  inFlight = null;
}
