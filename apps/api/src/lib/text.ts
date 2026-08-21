/**
 * Truncate without splitting a surrogate pair.
 *
 * A plain `slice` can cut an emoji in half, leaving a lone high surrogate. That
 * serialises to invalid JSON and Anthropic rejects the whole request with a
 * non-retryable 400 — one clipped emoji kills a batch of ten messages.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);

  // Trailing high surrogate with its pair beyond the cut — drop it.
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return isHighSurrogate ? cut.slice(0, -1) : cut;
}
