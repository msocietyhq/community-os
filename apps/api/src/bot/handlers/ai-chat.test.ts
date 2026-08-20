import { describe, expect, test } from "bun:test";
import { markdownToHtml } from "./ai-chat";

/**
 * Everything the bot sends is LLM output rendered with parse_mode: "HTML" —
 * including ask_user questions, which may quote a member's own words back.
 * Escaping happens before markdown conversion, so injected markup is inert.
 */
describe("markdownToHtml", () => {
  test("plain text passes through", () => {
    expect(markdownToHtml("hello there")).toBe("hello there");
  });

  test("escapes HTML before converting markdown", () => {
    expect(markdownToHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  test("escapes ampersands", () => {
    expect(markdownToHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  test("a member's injected tags cannot become real markup", () => {
    const out = markdownToHtml('Did you mean <b onclick="x">this</b>?');
    // The text survives verbatim; what matters is that no real tag is emitted.
    expect(out).toContain("&lt;b onclick=");
    expect(out).not.toMatch(/<b[ >]/);
    expect(out).not.toContain("</b>");
  });

  test("bold, italic and code convert to Telegram tags", () => {
    expect(markdownToHtml("**bold**")).toBe("<b>bold</b>");
    expect(markdownToHtml("*italic*")).toBe("<i>italic</i>");
    expect(markdownToHtml("_italic_")).toBe("<i>italic</i>");
    expect(markdownToHtml("`code`")).toBe("<code>code</code>");
  });

  test("links convert to anchors", () => {
    expect(markdownToHtml("[msociety](https://msociety.dev)")).toBe(
      '<a href="https://msociety.dev">msociety</a>',
    );
  });

  test("bold wins over italic on doubled asterisks", () => {
    expect(markdownToHtml("**strong**")).not.toContain("<i>");
  });

  test("italic does not span newlines", () => {
    // A lone asterisk on one line shouldn't italicise the rest of the message.
    expect(markdownToHtml("2 * 3\nand 4 * 5")).toBe("2 * 3\nand 4 * 5");
  });

  test("empty input is safe", () => {
    expect(markdownToHtml("")).toBe("");
  });

  test("a question containing markup is safe to send", () => {
    const question = 'Which event — "<Tech Halaqah>" or "AI & Ethics"?';
    const out = markdownToHtml(question);
    expect(out).toContain("&lt;Tech Halaqah&gt;");
    expect(out).toContain("AI &amp; Ethics");
  });
});
