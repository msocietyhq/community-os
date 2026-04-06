import type { ThisWeekInHistory } from "../../services/digest.service";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatHistoryDigest(history: ThisWeekInHistory): string {
  const lines: string[] = [];

  lines.push("\uD83D\uDCF0 <b>This Week in MSOCIETY History</b>");
  lines.push("");
  lines.push(escapeHtml(history.summary));

  if (history.highlightedMessage && history.highlightedMessageAuthor) {
    const author = escapeHtml(history.highlightedMessageAuthor);
    lines.push("");
    lines.push(`<blockquote>"${escapeHtml(history.highlightedMessage)}"\n\u2014 ${author}</blockquote>`);
  }

  return lines.join("\n");
}
