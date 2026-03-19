import type { ThisWeekInHistory } from "../../services/digest.service";

export function formatHistoryDigest(history: ThisWeekInHistory): string {
  const lines: string[] = [];

  lines.push("\uD83D\uDCF0 *This Week in MSOCIETY History*");
  lines.push("");
  lines.push(history.summary);

  return lines.join("\n");
}
