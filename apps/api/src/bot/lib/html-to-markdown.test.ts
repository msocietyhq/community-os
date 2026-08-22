import { describe, expect, test } from "bun:test";
import { htmlToMarkdown } from "./html-to-markdown";

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
