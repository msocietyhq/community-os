import { describe, expect, test } from "bun:test";
import {
  guardToolResult,
  isOversized,
  MAX_TOOL_RESULT_CHARS,
  type OversizedResult,
} from "./tool-result-guard";

const oversized = (r: unknown): OversizedResult => r as OversizedResult;

describe("guardToolResult", () => {
  test("small results pass through by identity", () => {
    const result = { members: [{ id: 1, name: "Aziz" }] };
    expect(guardToolResult(result)).toBe(result);
  });

  test("null and undefined are left alone", () => {
    expect(guardToolResult(null)).toBeNull();
    expect(guardToolResult(undefined)).toBeUndefined();
  });

  test("an oversized result is replaced with an actionable error", () => {
    const huge = { image: "x".repeat(MAX_TOOL_RESULT_CHARS + 1) };
    const out = oversized(guardToolResult(huge));

    expect(out.error).toBe("Result too large to return");
    expect(out.limitChars).toBe(MAX_TOOL_RESULT_CHARS);
    expect(out.resultChars).toBeGreaterThan(MAX_TOOL_RESULT_CHARS);
  });

  /** Without this the model retries the identical query and fails again. */
  test("the error tells the model how to retry", () => {
    const out = oversized(guardToolResult({ x: "y".repeat(60_000) }));
    expect(out.hint).toContain("fewer fields");
    expect(out.hint).toContain("image");
    expect(out.hint).toContain("paginate");
  });

  test("the payload never reaches the model", () => {
    const secret = "z".repeat(60_000);
    const out = JSON.stringify(guardToolResult({ blob: secret }));
    expect(out).not.toContain(secret);
    expect(out.length).toBeLessThan(1_000);
  });

  test("the boundary is inclusive", () => {
    const exact = "a".repeat(8);
    // JSON.stringify("aaaaaaaa") is 10 chars including quotes.
    expect(guardToolResult(exact, 10)).toBe(exact);
    expect(oversized(guardToolResult(exact, 9)).error).toBeDefined();
  });

  test("unserialisable results are rejected rather than thrown on", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const out = oversized(guardToolResult(circular));
    expect(out.error).toBe("Result too large to return");
    expect(out.resultChars).toBe(-1);
  });

  test("isOversized reports without transforming", () => {
    expect(isOversized({ a: 1 })).toBe(false);
    expect(isOversized({ a: "x".repeat(60_000) })).toBe(true);
  });

  /**
   * Regression: a members listing selecting user { image } produced 479,358
   * tokens against a 200,000 limit and killed the sub-agent.
   */
  test("a members listing with base64 images is caught", () => {
    const members = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`,
      name: `Member ${i}`,
      image: `data:image/jpeg;base64,${"/9j/4AAQ".repeat(18_000)}`,
    }));
    expect(oversized(guardToolResult({ members })).error).toBeDefined();
  });
});
