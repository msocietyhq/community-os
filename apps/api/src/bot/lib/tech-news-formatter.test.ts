import { describe, expect, test } from "bun:test";
import { formatTechNews } from "./tech-news-formatter";
import type { TechNews } from "../../services/tech-news.service";

/** Most assertions care about the content, not where the split lands. */
function render(news: TechNews): string {
  return formatTechNews(news).join("\n");
}

const empty: TechNews = { stories: [], repos: [], local: [], islamic: [] };

function story(n: number, why = "Why it matters.") {
  return { title: `Story ${n}`, url: `https://example.com/${n}`, why };
}

describe("formatTechNews", () => {
  test("renders each section with its heading", () => {
    const out = render({
      stories: [story(1)],
      repos: [
        { name: "acme/thing", url: "https://github.com/acme/thing", stars: 1500, why: "Useful." },
      ],
      local: [story(2)],
      islamic: [story(3)],
    });

    expect(out).toContain("🔍 <b>The Stack Trace</b>");
    expect(out).toContain("<b>Rising on GitHub</b>");
    expect(out).toContain("<b>Singapore &amp; SEA</b>");
    expect(out).toContain("<b>Muslim Tech &amp; Fintech</b>");
    expect(out).toContain("1.5k stars");
  });

  test("omits headings for sections with no items", () => {
    const out = render({ ...empty, stories: [story(1)] });
    expect(out).not.toContain("Rising on GitHub");
    expect(out).not.toContain("Singapore");
    expect(out).not.toContain("Muslim Tech");
  });

  test("escapes HTML in titles and blurbs", () => {
    const out = render({
      ...empty,
      stories: [{ title: "Rust <script> & you", url: "https://e.com/a", why: "A & B" }],
    });
    expect(out).toContain("Rust &lt;script&gt; &amp; you");
    expect(out).toContain("A &amp; B");
    expect(out).not.toContain("<script>");
  });

  test("keeps query strings valid inside the href", () => {
    const out = render({
      ...empty,
      stories: [{ title: "T", url: "https://e.com/a?x=1&y=2", why: "w" }],
    });
    expect(out).toContain('href="https://e.com/a?x=1&amp;y=2"');
  });

  test("strips an aggregator suffix but keeps real title tails", () => {
    const out = render({
      ...empty,
      stories: [
        { title: "Model runs locally | VentureBeat", url: "https://e.com/1", why: "w" },
        { title: "Agents found bugs - Help Net Security", url: "https://e.com/2", why: "w" },
        { title: "Self-hosting - is it worth it?", url: "https://e.com/3", why: "w" },
      ],
    });

    expect(out).toContain(">Model runs locally<");
    expect(out).toContain(">Agents found bugs<");
    // A trailing clause that ends in punctuation is part of the headline.
    expect(out).toContain(">Self-hosting - is it worth it?<");
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
        expect(part.length).toBeLessThanOrEqual(4096);
      }
    });

    test("spills into a follow-up rather than truncating", () => {
      const parts = formatTechNews(crowded);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.length).toBeLessThanOrEqual(2);
      expect(parts[0]).toContain("Story 0");
    });

    test("only the first message carries the title header", () => {
      const parts = formatTechNews(crowded);
      expect(parts[0]).toContain("The Stack Trace");
      for (const part of parts.slice(1)) {
        expect(part).not.toContain("The Stack Trace");
      }
    });

    test("no message is blank", () => {
      for (const part of formatTechNews(crowded)) {
        expect(part.trim().length).toBeGreaterThan(0);
      }
    });

    test("a section split across messages repeats its heading", () => {
      // Sized so the GitHub section straddles the boundary.
      const parts = formatTechNews({
        ...empty,
        stories: Array.from({ length: 6 }, (_, i) => story(i, "y".repeat(500))),
        repos: Array.from({ length: 3 }, (_, i) => ({
          name: `o/r${i}`,
          url: `https://github.com/o/r${i}`,
          stars: 900,
          why: "y".repeat(500),
        })),
      });

      for (const part of parts) {
        // Any bullet must be preceded by a heading somewhere above it, except
        // in the story section which intentionally has none.
        const firstBullet = part.indexOf("•");
        if (firstBullet === -1) continue;
        const before = part.slice(0, firstBullet);
        const opensSection = /<b>/.test(before);
        const isStorySection = part.includes("The Stack Trace");
        expect(opensSection || isStorySection).toBe(true);
      }
    });

    test("never leaves a heading with nothing under it", () => {
      const out = render(crowded);
      for (const heading of ["Rising on GitHub", "Singapore &amp; SEA", "Muslim Tech &amp; Fintech"]) {
        if (!out.includes(`<b>${heading}</b>`)) continue;
        const after = out.slice(out.indexOf(`<b>${heading}</b>`) + heading.length + 7);
        expect(after.trimStart().startsWith("•")).toBe(true);
      }
    });
  });
});
