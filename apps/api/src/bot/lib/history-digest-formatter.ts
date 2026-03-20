import type { ThisWeekInHistory } from "../../services/digest.service";

export function formatHistoryDigest(history: ThisWeekInHistory): string {
  const lines: string[] = [];

  lines.push("\uD83D\uDCF0 *This Week in MSOCIETY History*");
  lines.push("");
  lines.push(history.summary);

  if (history.highlightedMessage) {
    const author = history.highlightedMessageAuthor ?? "someone";
    lines.push("");
    lines.push(`_"${history.highlightedMessage}"_`);
    lines.push(`— ${author}`);
  }

  return lines.join("\n");
}
