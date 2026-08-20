import { describe, expect, test } from "bun:test";
import { htmlToText } from "./research";

describe("htmlToText", () => {
  test("strips tags and collapses whitespace", () => {
    expect(htmlToText("<h1>Bun 1.3</h1>\n\n<p>Ships an   S3 client.</p>")).toBe(
      "Bun 1.3 Ships an S3 client.",
    );
  });

  test("drops script, style and noscript bodies", () => {
    const html =
      "<style>body{color:red}</style><script>alert('x')</script>" +
      "<noscript>enable js</noscript><p>Real content</p>";
    expect(htmlToText(html)).toBe("Real content");
  });

  test("drops comments", () => {
    expect(htmlToText("<p>A<!-- hidden note -->B</p>")).toBe("A B");
  });

  test("decodes the common entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &quot;quoted&quot; &lt;tag&gt; &#39;s</p>")).toBe(
      "Tom & Jerry \"quoted\" <tag> 's",
    );
  });

  test("nbsp becomes a normal space", () => {
    expect(htmlToText("<p>a&nbsp;&nbsp;b</p>")).toBe("a b");
  });

  test("empty and tag-only documents yield an empty string", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("<div><span></span></div>")).toBe("");
  });

  test("plain text passes through unchanged", () => {
    expect(htmlToText("just words")).toBe("just words");
  });

  /** Script contents must not leak into the text handed to the model. */
  test("script bodies never reach the output", () => {
    const out = htmlToText("<script>const key='SECRET'</script><p>hi</p>");
    expect(out).not.toContain("SECRET");
    expect(out).toBe("hi");
  });
});
