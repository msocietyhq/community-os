/**
 * Size guard for tool results.
 *
 * A tool result is appended to the conversation and sent back to the model on
 * the next step, so an oversized one is fatal: a members listing that selected
 * `user { image }` once produced a 479,358-token prompt against a 200,000
 * limit, killing the sub-agent outright.
 *
 * Truncating silently would be worse — the model would reason over partial
 * data believing it complete. Instead the result is replaced with an error the
 * model can act on.
 */

/**
 * Roughly 12k tokens at ~4 chars/token. Large enough for any reasonable page
 * of results, small enough to leave room for the rest of the conversation.
 */
export const MAX_TOOL_RESULT_CHARS = 50_000;

export interface OversizedResult {
  error: string;
  resultChars: number;
  limitChars: number;
  hint: string;
}

export function isOversized(value: unknown, max = MAX_TOOL_RESULT_CHARS): boolean {
  return measure(value) > max;
}

function measure(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    // Circular or otherwise unserialisable — it can't be sent anyway.
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Returns the result unchanged, or an actionable error when it is too large.
 *
 * The hint matters: without it the model retries the identical query and
 * fails the same way.
 */
export function guardToolResult<T>(
  result: T,
  max = MAX_TOOL_RESULT_CHARS,
): T | OversizedResult {
  const size = measure(result);
  if (size <= max) return result;

  return {
    error: "Result too large to return",
    resultChars: Number.isFinite(size) ? size : -1,
    limitChars: max,
    hint:
      "Re-run with fewer fields selected and a smaller page size. Never select " +
      "image or other binary/base64 fields. If you need many rows, paginate and " +
      "summarise each page instead of requesting them all at once.",
  };
}
