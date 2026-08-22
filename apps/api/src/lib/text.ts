/**
 * Truncate without breaking a character apart.
 *
 * A plain `slice` can cut an emoji in half, leaving a lone high surrogate. That
 * serialises to invalid JSON and Anthropic rejects the whole request with a
 * non-retryable 400 — one clipped emoji kills a batch of ten messages.
 *
 * Uses `Intl.Segmenter` rather than surrogate arithmetic, so whole grapheme
 * clusters survive. Surrogate handling alone still shredded ZWJ sequences: a
 * family emoji cut mid-sequence became a string of disconnected people rather
 * than an invalid string, which is well-formed and still wrong.
 */

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Widest grapheme cluster worth considering at the boundary. Segmenting a whole
 * document to trim its tail would be wasteful; nothing legitimate is longer.
 */
const BOUNDARY_WINDOW = 64;

export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;

  let out = "";
  for (const { segment } of segmenter.segment(
    text.slice(0, max + BOUNDARY_WINDOW),
  )) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}

/**
 * Truncate and mark that something was cut, for text a model or member reads.
 *
 * The ellipsis is inside the budget, so the result never exceeds `max`.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  // trimEnd so the ellipsis follows the word rather than floating after a space.
  return `${truncate(text, max - 1).trimEnd()}…`;
}

/**
 * Compact number for display: 999 → "999", 16206 → "16.2K", 2.5e6 → "2.5M".
 *
 * `Intl` rather than manual thresholds — the hand-rolled version rendered
 * 999,999 as "1000.0k" because each magnitude was tested independently.
 */
const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompact(value: number): string {
  return compactNumber.format(value);
}
