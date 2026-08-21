import { describe, expect, test } from "bun:test";
import { truncate } from "./text";

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("truncate", () => {
  test("returns short strings unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("truncates plain text at the limit", () => {
    expect(truncate("abcdef", 3)).toBe("abc");
  });

  test("never splits a surrogate pair", () => {
    // "tbh 😀" — the cut lands between the emoji's two code units.
    const text = "tbh \u{1F600}more";
    const out = truncate(text, 5);
    expect(LONE.test(out)).toBe(false);
    expect(out).toBe("tbh ");
  });

  test("keeps a complete emoji when it fits", () => {
    const text = "tbh \u{1F600}more";
    expect(truncate(text, 6)).toBe("tbh \u{1F600}");
  });

  test("output is always well-formed across every cut point", () => {
    const text = "a\u{1F600}b\u{1F601}c\u{1F602}d";
    for (let i = 0; i <= text.length; i++) {
      expect(LONE.test(truncate(text, i))).toBe(false);
    }
  });

  test("handles an empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});
