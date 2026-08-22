const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

/**
 * Escapes text for Telegram's HTML parse mode.
 *
 * Telegram rejects a whole message whose markup doesn't parse, so anything
 * interpolated into a formatted message must go through here — a single stray
 * `<` in an admin's welcome text or a member's display name would otherwise
 * take down the entire message rather than just garbling one word.
 *
 * HTML mode needs only these three; legacy Markdown's `_` and `*` are the
 * reason these pages don't use Markdown at all.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => HTML_ESCAPES[char] ?? char);
}
