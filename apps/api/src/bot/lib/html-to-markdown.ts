import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
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

/**
 * Main content of a web page as Markdown, with the site furniture removed.
 *
 * Converting a page faithfully is not the same as making it readable. A docs
 * page converts to a screen of nav links, logos and a search box before the
 * first real sentence — which then eats the whole per-page budget and leaves
 * the model reasoning about a menu.
 *
 * Readability is the same extractor Firefox Reader Mode uses; it scores blocks
 * by text density and link ratio to find the article. It runs on a linkedom
 * DOM rather than jsdom — a fraction of the install size, and it never executes
 * scripts.
 *
 * Falls back to converting the whole document when extraction fails, which is
 * the honest outcome for pages that aren't articles at all (dashboards, index
 * pages). Something imperfect beats nothing.
 */
export function pageToMarkdown(html: string, url?: string): string {
  if (!html.trim()) return "";

  try {
    // Readability mutates the document it is given, so this parse is throwaway.
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document).parse();

    if (article?.content) {
      const body = htmlToMarkdown(article.content);
      if (body) {
        // The title is usually an <h1> Readability strips out of the body.
        return article.title ? `# ${article.title}\n\n${body}` : body;
      }
    }
  } catch (err) {
    console.error("[html-to-markdown] readability failed for", url, err);
  }

  return htmlToMarkdown(html);
}
