import { FormattedString } from "@grammyjs/parse-mode";
import type { ThisMonthInHistory } from "../../services/digest.service";

/**
 * Entities rather than HTML: the summary and the quoted message are member
 * words and model output, so anything could be in them. With no parse mode
 * there is nothing for a stray `<` or `&` to break.
 */
export function formatHistoryDigest(history: ThisMonthInHistory): FormattedString {
  const parts: FormattedString[] = [
    FormattedString.b("📰 This Month in MSOCIETY History"),
    new FormattedString(""),
    new FormattedString(history.summary),
  ];

  if (history.highlightedMessage && history.highlightedMessageAuthor) {
    parts.push(
      new FormattedString(""),
      FormattedString.blockquote(
        `"${history.highlightedMessage}"\n— ${history.highlightedMessageAuthor}`,
      ),
    );
  }

  return FormattedString.join(parts, "\n");
}
