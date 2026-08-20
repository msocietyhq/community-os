import { describe, expect, test } from "bun:test";
import {
  applyRelativeCutoff,
  memoryWeight,
  rankByConfidenceAndRecency,
  DEFAULT_RELATIVE_CUTOFF,
  MIN_SIMILARITY_FLOOR,
  RECENCY_HALF_LIFE_DAYS,
} from "./memory-ranking";

const m = (id: string, similarity: number) => ({ id, similarity });

describe("applyRelativeCutoff", () => {
  test("empty input → empty output", () => {
    expect(applyRelativeCutoff([], 0.15)).toEqual([]);
  });

  test("single memory is always kept, however weak", () => {
    const result = applyRelativeCutoff([m("a", 0.36)], 0.15);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a");
  });

  test("keeps matches within the cutoff of the top score", () => {
    const result = applyRelativeCutoff(
      [m("a", 0.64), m("b", 0.55), m("c", 0.50)],
      0.15,
    );
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("drops matches further than the cutoff from the top score", () => {
    const result = applyRelativeCutoff(
      [m("a", 0.64), m("b", 0.55), m("c", 0.40)],
      0.15,
    );
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("boundary score is inclusive", () => {
    const result = applyRelativeCutoff([m("a", 0.60), m("b", 0.45)], 0.15);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("unsorted input is ranked before the cutoff is applied", () => {
    const result = applyRelativeCutoff(
      [m("weak", 0.40), m("best", 0.70), m("mid", 0.62)],
      0.15,
    );
    expect(result.map((r) => r.id)).toEqual(["best", "mid"]);
  });

  test("cutoff of 0 keeps only ties with the top score", () => {
    const result = applyRelativeCutoff([m("a", 0.7), m("b", 0.7), m("c", 0.69)], 0);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("does not mutate the input array", () => {
    const input = [m("a", 0.4), m("b", 0.8)];
    applyRelativeCutoff(input, 0.15);
    expect(input.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("defaults to DEFAULT_RELATIVE_CUTOFF when omitted", () => {
    const justInside = 0.7 - DEFAULT_RELATIVE_CUTOFF;
    const result = applyRelativeCutoff([m("a", 0.7), m("b", justInside)]);
    expect(result).toHaveLength(2);
  });

  /**
   * Regression: relevant pairs on the live corpus score 0.40–0.65 with
   * voyage-3-lite. A floor at 0.6 discarded nearly every true positive.
   */
  test("floor is low enough to admit real matches observed in production", () => {
    const observed = [0.544, 0.533, 0.522, 0.578, 0.643];
    for (const score of observed) {
      expect(score).toBeGreaterThan(MIN_SIMILARITY_FLOOR);
    }
  });
});

// ─── rankByConfidenceAndRecency ──────────────────────────────────────────────

describe("rankByConfidenceAndRecency", () => {
  const NOW = new Date("2026-08-20T00:00:00Z");
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  const mem = (id: string, confidence: number, ageDays: number) => ({
    id,
    confidence,
    createdAt: daysAgo(ageDays),
  });

  test("empty input → empty output", () => {
    expect(rankByConfidenceAndRecency([], NOW, 5)).toEqual([]);
  });

  test("at equal age, higher confidence wins", () => {
    const result = rankByConfidenceAndRecency(
      [mem("low", 0.5, 10), mem("high", 0.9, 10)],
      NOW,
      5,
    );
    expect(result.map((m) => m.id)).toEqual(["high", "low"]);
  });

  test("at equal confidence, more recent wins", () => {
    const result = rankByConfidenceAndRecency(
      [mem("old", 0.8, 300), mem("new", 0.8, 2)],
      NOW,
      5,
    );
    expect(result.map((m) => m.id)).toEqual(["new", "old"]);
  });

  /**
   * The point of the decay: a durable fact shouldn't be evicted by fresh
   * trivia, which is what pure newest-first ordering did.
   */
  test("a durable high-confidence fact outranks recent low-confidence trivia", () => {
    const result = rankByConfidenceAndRecency(
      [mem("trivia", 0.5, 0), mem("durable", 0.95, 60)],
      NOW,
      5,
    );
    expect(result[0]?.id).toBe("durable");
  });

  test("but a recent correction beats a very old claim", () => {
    const result = rankByConfidenceAndRecency(
      [mem("stale", 0.9, 900), mem("correction", 0.8, 1)],
      NOW,
      5,
    );
    expect(result[0]?.id).toBe("correction");
  });

  test("honours the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => mem(`m${i}`, 0.8, i));
    expect(rankByConfidenceAndRecency(many, NOW, 5)).toHaveLength(5);
  });

  test("does not mutate the input array", () => {
    const input = [mem("a", 0.5, 100), mem("b", 0.9, 1)];
    rankByConfidenceAndRecency(input, NOW, 5);
    expect(input.map((m) => m.id)).toEqual(["a", "b"]);
  });

  test("weight halves after one half-life", () => {
    const fresh = memoryWeight({ confidence: 1, createdAt: NOW }, NOW);
    const aged = memoryWeight(
      { confidence: 1, createdAt: daysAgo(RECENCY_HALF_LIFE_DAYS) },
      NOW,
    );
    expect(fresh).toBeCloseTo(1, 5);
    expect(aged).toBeCloseTo(0.5, 5);
  });

  test("future timestamps do not inflate weight above confidence", () => {
    const future = new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000);
    expect(memoryWeight({ confidence: 0.8, createdAt: future }, NOW)).toBeCloseTo(0.8, 5);
  });
});
