import type { NewsItem, TechNews } from "../../services/tech-news.service";

/**
 * Telegram rejects a message over 4096 characters outright, so a busy week
 * would fail the whole post rather than trim it. Budget below the limit and
 * spill into a follow-up message instead.
 */
const MAX_MESSAGE_CHARS = 4000;

/** Beyond this the roundup stops being a roundup. Extra items are dropped. */
const MAX_MESSAGES = 2;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatStars(stars: number): string {
  return stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : String(stars);
}

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

function link(url: string, label: string): string {
  // encodeURI leaves `&` alone; escaping after it keeps query strings valid
  // inside an HTML attribute without double-encoding existing `%` sequences.
  return `<a href="${escapeHtml(encodeURI(url))}">${escapeHtml(stripSiteSuffix(label))}</a>`;
}

/** One rendered entry: its heading (when it opens a section) and its lines. */
interface Block {
  heading?: string;
  lines: string[];
}

function newsBlocks(heading: string | null, items: NewsItem[]): Block[] {
  return items.map((item, i) => ({
    heading: i === 0 && heading ? heading : undefined,
    lines: [`• ${link(item.url, item.title)}`, `  <i>${escapeHtml(item.why)}</i>`],
  }));
}

/**
 * Renders the roundup as one or more Telegram messages, in order.
 *
 * A section split across the boundary repeats its heading in the follow-up, so
 * the second message doesn't open with bullets belonging to nothing.
 */
export function formatTechNews(news: TechNews): string[] {
  const blocks: Block[] = [
    ...newsBlocks(null, news.stories),
    ...news.repos.map((r, i) => ({
      heading: i === 0 ? "Rising on GitHub" : undefined,
      lines: [
        `• ${link(r.url, r.name)} — ${formatStars(r.stars)} stars`,
        `  <i>${escapeHtml(r.why)}</i>`,
      ],
    })),
    ...newsBlocks("Singapore &amp; SEA", news.local),
    ...newsBlocks("Muslim Tech &amp; Fintech", news.islamic),
  ];

  const messages: string[] = [];
  let lines: string[] = ["📡 <b>This Week in Tech</b>"];
  let length = lines[0]!.length;
  /** Heading whose section is still open, so a spill can repeat it. */
  let openHeading: string | null = null;
  /** Heading of a section whose items were skipped, not yet placed. */
  let pendingHeading: string | null = null;

  const cost = (candidate: string[]) =>
    candidate.reduce((sum, l) => sum + l.length + 1, 0);

  for (const block of blocks) {
    if (block.heading) {
      openHeading = block.heading;
      pendingHeading = block.heading;
    }

    const heading = pendingHeading;
    const candidate = ["", ...(heading ? [`<b>${heading}</b>`] : []), ...block.lines];

    if (length + cost(candidate) <= MAX_MESSAGE_CHARS) {
      lines.push(...candidate);
      length += cost(candidate);
      pendingHeading = null;
      continue;
    }

    if (messages.length + 1 >= MAX_MESSAGES) {
      // Out of room entirely — drop this item, but keep its heading pending so
      // a later, shorter item can still open the section properly.
      continue;
    }

    // Spill into a follow-up, repeating the heading of a section left open.
    messages.push(lines.join("\n"));
    const carried = heading ?? openHeading;
    const continuation = [
      ...(carried ? [`<b>${carried}</b>`] : []),
      ...block.lines,
    ];
    lines = continuation;
    length = cost(continuation);
    pendingHeading = null;
  }

  messages.push(lines.join("\n"));
  return messages;
}
