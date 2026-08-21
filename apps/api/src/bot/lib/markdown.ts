/**
 * Convert Markdown output from the AI into Telegram HTML.
 *
 * Escapes HTML entities first, then maps ** / * / _ / ` to tags — so markup in
 * LLM output, or in a member's own words quoted back to them, is inert.
 *
 * Kept free of env/grammy imports so it can be unit tested in isolation.
 */
export function markdownToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/\*([^*\n]+?)\*/g, "<i>$1</i>")
    .replace(/_([^_\n]+?)_/g, "<i>$1</i>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}
