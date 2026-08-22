import { describe, expect, test } from "bun:test";
import { htmlToMarkdown, pageToMarkdown } from "./html-to-markdown";

describe("pageToMarkdown", () => {
  /** A page shaped like a real one: chrome around a single article. */
  const page = `<!doctype html><html><head><title>Why Postgres</title></head><body>
    <header><nav><a href="/">Home</a><a href="/docs">Docs</a><a href="/blog">Blog</a>
      <a href="/pricing">Pricing</a><a href="/login">Log in</a></nav></header>
    <article>
      <h1>Why Postgres</h1>
      <p>Postgres handles the overwhelming majority of workloads teams reach for
         specialised databases to solve, and it does so with one operational story
         instead of several. That matters more than raw benchmark numbers.</p>
      <p>The extension ecosystem covers full-text search, vector similarity and
         time-series partitioning, so a team can defer the second datastore for
         a very long time — often permanently.</p>
    </article>
    <footer><a href="/tos">Terms</a><a href="/privacy">Privacy</a></footer></body></html>`;

  test("keeps the article and drops the site furniture", () => {
    const out = pageToMarkdown(page, "https://example.com/why-postgres");

    expect(out).toContain("Postgres handles the overwhelming majority");
    expect(out).toContain("extension ecosystem");
    // Nav and footer links are what otherwise eat the page budget.
    expect(out).not.toContain("/pricing");
    expect(out).not.toContain("Privacy");
  });

  test("leads with the title so the model knows what it is reading", () => {
    expect(pageToMarkdown(page)).toStartWith("# Why Postgres");
  });

  test("falls back to a full conversion when there is no article", () => {
    // An index page has no prose body for Readability to score.
    const out = pageToMarkdown("<html><body><a href='/a'>One</a></body></html>");
    expect(out).toContain("One");
  });

  test("empty input yields an empty string", () => {
    expect(pageToMarkdown("")).toBe("");
    expect(pageToMarkdown("   ")).toBe("");
  });

  test("never executes or emits script contents", () => {
    const out = pageToMarkdown(
      `<html><body><script>const key='SECRET'</script><article><h1>T</h1>
       <p>${"Real prose that is long enough to be scored as content. ".repeat(6)}</p>
       </article></body></html>`,
    );
    expect(out).not.toContain("SECRET");
  });
});

describe("htmlToMarkdown", () => {
  test("keeps document structure the model can use", () => {
    expect(htmlToMarkdown("<h1>Bun 1.3</h1><p>Ships an   S3 client.</p>")).toBe(
      "# Bun 1.3\n\nShips an S3 client.",
    );
  });

  test("keeps link targets, not just the anchor text", () => {
    // The regex version dropped every href, so the agent could see that a page
    // linked somewhere but never where.
    expect(htmlToMarkdown('<p>see <a href="https://x.com/d">docs</a></p>')).toBe(
      "see [docs](https://x.com/d)",
    );
  });

  test("preserves lists and code blocks", () => {
    const out = htmlToMarkdown(
      "<ul><li>one</li><li>two</li></ul><pre><code>const a = 1;</code></pre>",
    );
    expect(out).toContain("* one");
    expect(out).toContain("* two");
    expect(out).toContain("const a = 1;");
  });

  test("drops script, style and noscript bodies", () => {
    expect(
      htmlToMarkdown(
        "<style>body{color:red}</style><script>alert('x')</script>" +
          "<noscript>enable js</noscript><p>Real content</p>",
      ),
    ).toBe("Real content");
  });

  test("drops comments", () => {
    expect(htmlToMarkdown("<p>A<!-- hidden note -->B</p>")).toBe("AB");
  });

  test("decodes the common entities", () => {
    expect(
      htmlToMarkdown("<p>Tom &amp; Jerry &quot;quoted&quot; &lt;tag&gt; &#39;s</p>"),
    ).toBe("Tom & Jerry \"quoted\" <tag> 's");
  });

  test("decodes hex numeric entities, which is what Hacker News returns", () => {
    expect(htmlToMarkdown("<p>don&#x27;t &#x2014; it&#X27;s fine</p>")).toBe(
      "don't — it's fine",
    );
  });

  test("does not double-decode an escaped ampersand", () => {
    // `&amp;lt;` is a literal "&lt;", not a less-than sign. The hand-rolled
    // version decoded `&amp;` first and invented markup here.
    expect(htmlToMarkdown("<p>&amp;lt;script&amp;gt;</p>")).toBe("&lt;script&gt;");
  });

  test("nbsp becomes a normal space", () => {
    expect(htmlToMarkdown("<p>a&nbsp;&nbsp;b</p>")).toBe("a b");
  });

  test("resolves legacy entities the way the HTML spec requires", () => {
    // `&not` is a valid named reference even without the semicolon, so
    // `&notreal;` really is "¬real;". Spec-correct, if surprising.
    expect(htmlToMarkdown("<p>&notreal;</p>")).toBe("¬real;");
  });

  test("empty and tag-only documents yield an empty string", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
    expect(htmlToMarkdown("<div><span></span></div>")).toBe("");
  });

  test("plain text passes through unchanged", () => {
    expect(htmlToMarkdown("just words")).toBe("just words");
  });

  /** Script contents must not leak into the text handed to the model. */
  test("script bodies never reach the output", () => {
    const out = htmlToMarkdown("<script>const key='SECRET'</script><p>hi</p>");
    expect(out).not.toContain("SECRET");
    expect(out).toBe("hi");
  });
});
