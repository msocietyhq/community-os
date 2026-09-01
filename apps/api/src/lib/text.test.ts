import { describe, expect, test } from "bun:test";
import { clip, formatCompact, truncate } from "./text";

const LONE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

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
    expect(truncate("abc", 0)).toBe("");
  });

  test("keeps a ZWJ sequence whole rather than shredding it", () => {
    // Surrogate-pair logic alone left "👨‍👩‍" here: well-formed, but a family
    // emoji turned into two disconnected people.
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const text = `hi ${family} there`;

    expect(truncate(text, 12)).toBe("hi ");
    // The whole cluster is 11 code units; it only survives once it fits.
    expect(truncate(text, 14)).toBe(`hi ${family}`);
  });

  test("never emits a partial cluster at any cut point", () => {
    const text = "a\u{1F600}b\u{1F468}‍\u{1F469}c";
    for (let i = 0; i <= text.length; i++) {
      const out = truncate(text, i);
      expect(LONE.test(out)).toBe(false);
      // Round-tripping through the segmenter must not change it.
      expect(
        [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(out)]
          .map((s) => s.segment)
          .join(""),
      ).toBe(out);
    }
  });
});

describe("clip", () => {
  test("leaves text within budget untouched", () => {
    expect(clip("hello", 10)).toBe("hello");
  });

  test("marks truncation and stays within the budget", () => {
    const out = clip("abcdefghij", 5);
    expect(out).toBe("abcd…");
    expect(out.length).toBe(5);
  });
});

describe("formatCompact", () => {
  test("formats across magnitudes", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(44)).toBe("44");
    expect(formatCompact(1500)).toBe("1.5K");
    expect(formatCompact(16206)).toBe("16.2K");
    expect(formatCompact(2_500_000)).toBe("2.5M");
  });

  test("rolls over to the next unit instead of overflowing", () => {
    // The hand-rolled version rendered this as "1000.0k".
    expect(formatCompact(999_999)).toBe("1M");
  });
});
