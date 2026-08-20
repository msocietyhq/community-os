import { describe, expect, test } from "bun:test";
import {
  applyRelativeCutoff,
  DEFAULT_RELATIVE_CUTOFF,
  MIN_SIMILARITY_FLOOR,
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
