import { FormattedString } from "@grammyjs/parse-mode";
import type { NewsItem, TechNews } from "../../services/tech-news.service";
import { formatCompact } from "../../lib/text";

/**
 * Telegram rejects a message over 4096 characters outright, so a busy week
 * would fail the whole post rather than trim it. Budget below the limit and
 * spill into a follow-up message instead.
 */
const MAX_MESSAGE_CHARS = 4000;

/** Beyond this the roundup stops being a roundup. Extra items are dropped. */
const MAX_MESSAGES = 2;

/** Only the first message carries it, so a spill doesn't read as a new post. */
const TITLE = "🔍 The Stack Trace";

/**
 * Aggregators tack their own name onto headlines. Drops a short trailing
 * segment after a separator, but only when it reads like a masthead rather
 * than part of the sentence.
 */
function stripSiteSuffix(title: string): string {
  const match = title.match(/^(.*\S)\s+[|–—-]\s+([^|–—-]{1,30})$/);
  if (!match) return title;

  const [, head, tail] = match;
  if (!head || !tail) return title;
  // A real masthead is a couple of words and doesn't end a sentence.
  if (tail.split(/\s+/).length > 4 || /[.!?,:]$/.test(tail)) return title;
  return head;
}

/** One rendered entry: its heading (when it opens a section) and its body. */
interface Block {
  heading?: string;
  body: FormattedString;
}

/** `• <link>` then an indented italic reason, as one two-line block. */
function entry(label: FormattedString, why: string): FormattedString {
  return new FormattedString("• ").concat(label).plain("\n  ").i(why);
}

function newsBlocks(heading: string | null, items: NewsItem[]): Block[] {
  return items.map((item, i) => ({
    heading: i === 0 && heading ? heading : undefined,
    body: entry(
      FormattedString.link(stripSiteSuffix(item.title), item.url),
      item.why,
    ),
  }));
}

/**
 * Renders the roundup as one or more Telegram messages, in order.
 *
 * Returns `FormattedString`s rather than markup: the text stays exactly as
 * written and the styling travels beside it as entities, so a headline
 * containing `<`, `&`, `_` or `*` can never break the message — there is no
 * parse mode left to break. Send with `{ entities: part.entities }`.
 *
 * A section split across the boundary repeats its heading in the follow-up, so
 * the second message doesn't open with bullets belonging to nothing.
 */
export function formatTechNews(news: TechNews): FormattedString[] {
  const blocks: Block[] = [
    ...newsBlocks(null, news.stories),
    ...news.repos.map((r, i) => ({
      heading: i === 0 ? "Rising on GitHub" : undefined,
      body: entry(
        FormattedString.link(r.name, r.url).plain(
          ` — ${formatCompact(r.stars)} stars`,
        ),
        r.why,
      ),
    })),
    ...newsBlocks("Singapore & SEA", news.local),
    ...newsBlocks("Muslim Tech & Fintech", news.islamic),
  ];

  const messages: FormattedString[] = [];
  let parts: FormattedString[] = [FormattedString.b(TITLE)];
  let length = TITLE.length;
  /** Heading whose section is still open, so a spill can repeat it. */
  let openHeading: string | null = null;
  /** Heading of a section whose items were skipped, not yet placed. */
  let pendingHeading: string | null = null;

  for (const block of blocks) {
    if (block.heading) {
      openHeading = block.heading;
      pendingHeading = block.heading;
    }

    const heading = pendingHeading;
    const candidate = heading
      ? [FormattedString.b(heading), block.body]
      : [block.body];
    // +1 per join separator, +1 for the blank line before the group.
    const cost = candidate.reduce((sum, p) => sum + p.text.length + 1, 0) + 1;

    if (length + cost <= MAX_MESSAGE_CHARS) {
      parts.push(new FormattedString(""), ...candidate);
      length += cost;
      pendingHeading = null;
      continue;
    }

    if (messages.length + 1 >= MAX_MESSAGES) {
      // Out of room entirely — drop this item, but keep its heading pending so
      // a later, shorter item can still open the section properly.
      continue;
    }

    // Spill into a follow-up, repeating the heading of a section left open.
    messages.push(FormattedString.join(parts, "\n"));
    const carried = heading ?? openHeading;
    parts = carried ? [FormattedString.b(carried), block.body] : [block.body];
    length = parts.reduce((sum, p) => sum + p.text.length + 1, 0);
    pendingHeading = null;
  }

  messages.push(FormattedString.join(parts, "\n"));
  return messages;
}
