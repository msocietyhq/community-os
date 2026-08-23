import { describe, expect, test } from "bun:test";
// Imported from the pure module, not the service: ai.service pulls in the
// database and `env`, which validates at import time and throws when the test
// runner hasn't loaded apps/api/.env.
import { AI_MODEL_IDS, estimateCost } from "./ai-pricing";

const SONNET = AI_MODEL_IDS.smart; // $3 in / $15 out per 1M

describe("estimateCost", () => {
  test("prices an uncached call at the base rate", () => {
    // 1M input at $3 + 1M output at $15.
    expect(estimateCost(SONNET, 1_000_000, 1_000_000)).toBeCloseTo(18, 10);
  });

  test("omitting the cache arguments matches the pre-cache behaviour", () => {
    // Rows written before the cache columns existed must price unchanged.
    expect(estimateCost(SONNET, 500_000, 0)).toBeCloseTo(
      estimateCost(SONNET, 500_000, 0, 0, 0),
      10,
    );
  });

  test("charges a cache read at a tenth of the input rate", () => {
    // Whole prompt cached: 1M * $3 * 0.1.
    expect(estimateCost(SONNET, 1_000_000, 0, 1_000_000, 0)).toBeCloseTo(
      0.3,
      10,
    );
  });

  test("charges a cache write at 1.25x the input rate", () => {
    expect(estimateCost(SONNET, 1_000_000, 0, 0, 1_000_000)).toBeCloseTo(
      3.75,
      10,
    );
  });

  test("treats the cache counts as slices of input, not additions", () => {
    // 1M prompt = 600k uncached + 300k read + 100k write.
    const expected = (600_000 + 300_000 * 0.1 + 100_000 * 1.25) * 3 / 1_000_000;
    expect(estimateCost(SONNET, 1_000_000, 0, 300_000, 100_000)).toBeCloseTo(
      expected,
      10,
    );
  });

  test("a write-only call costs 25% more than not caching at all", () => {
    // The regression this pricing exists to make visible: a one-shot call that
    // writes the cache and never reads it is strictly worse than no caching.
    const uncached = estimateCost(SONNET, 1_000_000, 0);
    const writeOnly = estimateCost(SONNET, 1_000_000, 0, 0, 1_000_000);
    expect(writeOnly / uncached).toBeCloseTo(1.25, 10);
  });

  test("never charges negative input when the counts overshoot", () => {
    // Defensive: provider drift must not produce a negative cost that would
    // credit the budget counter and loosen the caps.
    expect(estimateCost(SONNET, 1000, 0, 900, 900)).toBeGreaterThanOrEqual(0);
  });

  test("an unknown model costs zero", () => {
    expect(estimateCost("claude-not-a-model", 1_000_000, 1_000_000)).toBe(0);
  });

  test("retired model ids still price, so history is not rewritten", () => {
    expect(estimateCost("claude-sonnet-4-5-20250929", 1_000_000, 0)).toBeCloseTo(
      3,
      10,
    );
  });
});
