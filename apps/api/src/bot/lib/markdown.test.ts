import { describe, expect, test } from "bun:test";
import { toTelegramMarkdown } from "./markdown";

/** Telegram rejects a message when any reserved character is left unescaped. */
const RESERVED = "_*[]()~`>#+-=|{}.!";

/** Conversion returns null only when it fails; tests assert on the success path. */
function must(text: string): string {
  const out = toTelegramMarkdown(text);
  if (out === null) throw new Error("conversion unexpectedly failed");
  return out;
}

function unescapedReserved(out: string): string[] {
  const bad: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    if (!RESERVED.includes(ch)) continue;
    if (i > 0 && out[i - 1] === "\\") continue;
    bad.push(ch);
  }
  return bad;
}

describe("toTelegramMarkdown", () => {
  // Each of these was mangled by the regex implementation this replaced.
  test("leaves snake_case identifiers intact", () => {
    const out = must("Set max_output_tokens and min_p in your_config.json");
    expect(out).toContain("max\\_output\\_tokens");
    expect(out).not.toContain("<i>");
  });

  test("keeps a URL containing brackets whole", () => {
    const out = must(
      "See [the docs](https://en.wikipedia.org/wiki/Foo_(bar)) for more.",
    );
    // The regex version truncated the href at the first inner paren, producing
    // a broken link and leaking a stray ")" into the text. Inside a link
    // destination MarkdownV2 only reserves ")" and "\", so the underscore
    // stays bare — what matters is that the whole path survives.
    expect(out).toContain("https://en.wikipedia.org/wiki/Foo_\\(bar\\)");
    expect(out).toContain("[the docs]");
  });

  test("renders a fenced code block as a code block", () => {
    const out = must("Try:\n```ts\nconst a = arr[0] * 2;\n```");
    expect(out).toContain("```");
    // Contents of a code fence must not be escaped or turned into emphasis.
    expect(out).toContain("const a = arr[0] * 2;");
  });

  test("does not italicise arithmetic with underscores", () => {
    const out = must("The formula a_1 + b_2 = c_3 holds.");
    expect(out).not.toContain("<i>");
    expect(out).toContain("a\\_1");
  });

  test("converts emphasis to MarkdownV2", () => {
    const out = must("**bold** and *italic*");
    expect(out).toContain("*bold*");
    expect(out).toContain("_italic_");
  });

  test("escapes constructs Telegram has no syntax for", () => {
    // A pipe table would otherwise break the parse.
    const out = must("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(unescapedReserved(out.replace(/```[\s\S]*?```/g, ""))).toEqual([]);
  });

  test("leaves no unescaped reserved characters in prose", () => {
    const out = must(
      "Costs $5.00 (roughly) — see item #3! Ratio is 1+2=3.",
    );
    expect(unescapedReserved(out)).toEqual([]);
  });

  test("returns a string for empty input rather than throwing", () => {
    expect(toTelegramMarkdown("")).not.toBeNull();
  });
});

