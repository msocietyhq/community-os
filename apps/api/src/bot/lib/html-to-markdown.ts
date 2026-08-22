import { NodeHtmlMarkdown } from "node-html-markdown";

/**
 * Turn a fetched page into Markdown for the model to read.
 *
 * Markdown rather than flat text on purpose: it keeps the structure a model
 * needs to interpret a page — headings, list boundaries, code blocks, tables —
 * and, most importantly, keeps link URLs. The previous regex version flattened
 * everything to one line and dropped every href, so the research agent could
 * see that a page linked somewhere but never where.
 *
 * It also got entities wrong in ways only a real parser avoids: hex escapes
 * (`&#x27;`, which is what Hacker News returns) survived into the prompt, and
 * decoding `&amp;` before the others turned `&amp;lt;` into a literal `<`,
 * inventing markup the page never contained.
 *
 * A shared instance — the translator compiles its rules once and is stateless
 * across calls.
 */
const translator = new NodeHtmlMarkdown({
  // The model reads this; reference-style links would strand the URLs in a
  // footer far from the text that mentions them.
  useLinkReferenceDefinitions: false,
  // Keeps long prose on one line per paragraph, which reads better as input
  // than hard-wrapped text and costs fewer tokens.
  maxConsecutiveNewlines: 2,
});

/** Readable Markdown from an HTML document or fragment. */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  try {
    return translator.translate(html).trim();
  } catch (err) {
    console.error("[html-to-markdown] parse failed:", err);
    return "";
  }
}
