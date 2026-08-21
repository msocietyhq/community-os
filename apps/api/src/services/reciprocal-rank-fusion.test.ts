import { describe, expect, test } from "bun:test";
import { fuseByRRF, RRF_K } from "./reciprocal-rank-fusion";

const row = (id: string, tag = "a") => ({ id, tag });
const idOf = (r: { id: string }) => r.id;

describe("fuseByRRF", () => {
  test("no lists → empty output", () => {
    expect(fuseByRRF([], idOf, 10)).toEqual([]);
  });

  test("all lists empty → empty output", () => {
    expect(fuseByRRF([[], []], idOf, 10)).toEqual([]);
  });

  test("a single list passes through in order", () => {
    const list = [row("a"), row("b"), row("c")];
    expect(fuseByRRF([list], idOf, 10).map(idOf)).toEqual(["a", "b", "c"]);
  });

  test("appearing in both lists outranks appearing in one", () => {
    // "b" is second in both; "a" is first in only one.
    // b scores 2/(K+2), a scores 1/(K+1) — for K=60 that is 0.0323 vs 0.0164.
    const semantic = [row("a"), row("b")];
    const lexical = [row("c"), row("b")];
    expect(fuseByRRF([semantic, lexical], idOf, 10).map(idOf)[0]).toBe("b");
  });

  test("respects the limit", () => {
    const list = [row("a"), row("b"), row("c"), row("d")];
    expect(fuseByRRF([list], idOf, 2).map(idOf)).toEqual(["a", "b"]);
  });

  test("the first list wins on identity when an id appears twice", () => {
    const semantic = [row("a", "semantic")];
    const lexical = [row("a", "lexical")];
    expect(fuseByRRF([semantic, lexical], idOf, 10)[0]?.tag).toBe("semantic");
  });

  test("exports the k constant the memory recall path was tuned with", () => {
    expect(RRF_K).toBe(60);
  });
});
