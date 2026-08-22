import { describe, expect, test } from "bun:test";
import type { FormattedString } from "@grammyjs/parse-mode";
import { formatTechNews } from "./tech-news-formatter";
import type { TechNews } from "../../services/tech-news.service";

/** Most assertions care about the content, not where the split lands. */
function render(news: TechNews): string {
  return formatTechNews(news)
    .map((p) => p.text)
    .join("\n");
}

/** Substrings styled with a given entity type, so styling can be asserted. */
function styled(parts: FormattedString[], type: string): string[] {
  return parts.flatMap((p) =>
    (p.entities ?? [])
      .filter((e) => e.type === type)
      .map((e) => p.text.slice(e.offset, e.offset + e.length)),
  );
}

function links(parts: FormattedString[]): { text: string; url: string }[] {
  return parts.flatMap((p) =>
    (p.entities ?? [])
      .filter((e): e is typeof e & { url: string } => e.type === "text_link")
      .map((e) => ({ text: p.text.slice(e.offset, e.offset + e.length), url: e.url })),
  );
}

const empty: TechNews = { stories: [], repos: [], local: [], islamic: [] };

function story(n: number, why = "Why it matters.") {
  return { title: `Story ${n}`, url: `https://example.com/${n}`, why };
}

describe("formatTechNews", () => {
  test("renders each section with its heading", () => {
    const parts = formatTechNews({
      stories: [story(1)],
      repos: [
        { name: "acme/thing", url: "https://github.com/acme/thing", stars: 1500, why: "Useful." },
      ],
      local: [story(2)],
      islamic: [story(3)],
    });

    expect(styled(parts, "bold")).toEqual([
      "🔍 The Stack Trace",
      "Rising on GitHub",
      "Singapore & SEA",
      "Muslim Tech & Fintech",
    ]);
    expect(parts[0]!.text).toContain("1.5K stars");
  });

  test("omits headings for sections with no items", () => {
    const parts = formatTechNews({ ...empty, stories: [story(1)] });
    expect(styled(parts, "bold")).toEqual(["🔍 The Stack Trace"]);
  });

  test("carries reasons as italic entities", () => {
    const parts = formatTechNews({ ...empty, stories: [story(1, "Because reasons.")] });
    expect(styled(parts, "italic")).toEqual(["Because reasons."]);
  });

  // The whole point of entities: text is never transformed, so nothing can
  // corrupt it. The HTML version had to escape all of this.
  test("leaves markup characters in titles completely untouched", () => {
    const parts = formatTechNews({
      ...empty,
      stories: [
        { title: "Rust <script> & you", url: "https://e.com/a", why: "A & B < C" },
      ],
    });

    expect(parts[0]!.text).toContain("Rust <script> & you");
    expect(parts[0]!.text).toContain("A & B < C");
    expect(parts[0]!.text).not.toContain("&amp;");
    expect(parts[0]!.text).not.toContain("&lt;");
  });

  test("leaves markdown characters in titles untouched", () => {
    const parts = formatTechNews({
      ...empty,
      stories: [{ title: "Use max_output_tokens *now*", url: "https://e.com/a", why: "w" }],
    });
    expect(parts[0]!.text).toContain("Use max_output_tokens *now*");
  });

  test("stores link targets verbatim, however awkward the URL", () => {
    const parts = formatTechNews({
      ...empty,
      stories: [
        { title: "T", url: "https://e.com/a?x=1&y=2#frag_(v)", why: "w" },
      ],
    });
    expect(links(parts)).toEqual([{ text: "T", url: "https://e.com/a?x=1&y=2#frag_(v)" }]);
  });

  test("strips an aggregator suffix but keeps real title tails", () => {
    const parts = formatTechNews({
      ...empty,
      stories: [
        { title: "Model runs locally | VentureBeat", url: "https://e.com/1", why: "w" },
        { title: "Agents found bugs - Help Net Security", url: "https://e.com/2", why: "w" },
        { title: "Self-hosting - is it worth it?", url: "https://e.com/3", why: "w" },
      ],
    });

    expect(links(parts).map((l) => l.text)).toEqual([
      "Model runs locally",
      "Agents found bugs",
      // A trailing clause that ends in punctuation is part of the headline.
      "Self-hosting - is it worth it?",
    ]);
  });

  describe("length budget", () => {
    const long = "x".repeat(400);
    const crowded: TechNews = {
      stories: Array.from({ length: 5 }, (_, i) => story(i, long)),
      repos: Array.from({ length: 4 }, (_, i) => ({
        name: `o/r${i}`,
        url: `https://github.com/o/r${i}`,
        stars: 900,
        why: long,
      })),
      local: Array.from({ length: 3 }, (_, i) => story(100 + i, long)),
      islamic: Array.from({ length: 3 }, (_, i) => story(200 + i, long)),
    };

    test("a short roundup stays a single message", () => {
      expect(formatTechNews({ ...empty, stories: [story(1)] })).toHaveLength(1);
    });

    test("every message fits Telegram's limit", () => {
      for (const part of formatTechNews(crowded)) {
        expect(part.text.length).toBeLessThanOrEqual(4096);
      }
    });

    test("spills into a follow-up rather than truncating", () => {
      const parts = formatTechNews(crowded);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.length).toBeLessThanOrEqual(2);
      expect(parts[0]!.text).toContain("Story 0");
    });

    test("only the first message carries the title header", () => {
      const parts = formatTechNews(crowded);
      expect(parts[0]!.text).toContain("The Stack Trace");
      for (const part of parts.slice(1)) {
        expect(part.text).not.toContain("The Stack Trace");
      }
    });

    test("no message is blank", () => {
      for (const part of formatTechNews(crowded)) {
        expect(part.text.trim().length).toBeGreaterThan(0);
      }
    });

    test("entity offsets stay inside the text of their own message", () => {
      // A split that miscounts would point an entity past the end, and
      // Telegram rejects the whole message for that.
      for (const part of formatTechNews(crowded)) {
        for (const e of part.entities ?? []) {
          expect(e.offset).toBeGreaterThanOrEqual(0);
          expect(e.offset + e.length).toBeLessThanOrEqual(part.text.length);
        }
      }
    });

    test("never leaves a heading with nothing under it", () => {
      const out = render(crowded);
      for (const heading of ["Rising on GitHub", "Singapore & SEA", "Muslim Tech & Fintech"]) {
        if (!out.includes(heading)) continue;
        const after = out.slice(out.indexOf(heading) + heading.length);
        expect(after.trimStart().startsWith("•")).toBe(true);
      }
    });
  });
});
