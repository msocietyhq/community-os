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
 * Output is MarkdownV2, so callers must send it with that parse mode. Pair it
 * with `sendFormatted` so a rejected message degrades to plain text rather than
 * vanishing.
 */
export function toTelegramMarkdown(text: string): string {
  try {
    // "escape" keeps unsupported constructs visible as literal text rather than
    // silently dropping content the model meant to convey.
    return telegramify(text, "escape");
  } catch (err) {
    // Never lose a reply over formatting. Escaping every reserved character by
    // hand is the one safe fallback: it renders as plain prose.
    console.error("[markdown] telegramify failed, falling back to plain:", err);
    return escapeMarkdownV2(text);
  }
}

/**
 * Escape every character MarkdownV2 reserves, per the Telegram Bot API spec.
 *
 * Only for the fallback path and for injecting untrusted literals — anything
 * with real Markdown in it should go through `toTelegramMarkdown`.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}
