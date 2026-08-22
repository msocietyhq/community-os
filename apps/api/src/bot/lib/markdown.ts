import telegramify from "telegramify-markdown";

/**
 * Convert Markdown from the AI into something Telegram will render.
 *
 * This used to be a chain of regexes, which corrupted the cases a tech
 * community hits constantly: `max_output_tokens` rendered as
 * "max<i>output</i>tokens", a URL containing brackets had its href truncated
 * mid-link, and fenced code blocks came out as malformed `<code>` with the
 * language tag inside. Markdown needs a parser, not pattern matching.
 *
 * `telegramify-markdown` is built for exactly this — it parses with remark and
 * emits MarkdownV2, escaping every reserved character and downgrading
 * constructs Telegram has no syntax for (tables, headings) instead of leaking
 * them raw.
 *
 * Returns MarkdownV2 to be sent with that parse mode, or `null` when the text
 * can't be converted. Callers send the original as plain text on `null` — with
 * no parse mode there is nothing to escape, so there is no reason to keep a
 * hand-written escaper around for the fallback.
 */
export function toTelegramMarkdown(text: string): string | null {
  try {
    // "escape" keeps unsupported constructs visible as literal text rather than
    // silently dropping content the model meant to convey.
    return telegramify(text, "escape");
  } catch (err) {
    console.error("[markdown] telegramify failed, falling back to plain:", err);
    return null;
  }
}
