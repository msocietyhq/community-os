/**
 * Retry with exponential backoff and full jitter.
 *
 * For background sweeps where a 429 should cost a pause, not the whole run. The
 * AI SDK retries its own model calls, but nothing covers the embedding calls or
 * a *sequence* that should be re-attempted as a unit.
 *
 * Pure apart from the clock — `sleep` is injectable so tests don't wait.
 */
import { APICallError } from "ai";

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected in tests so backoff doesn't cost real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Full jitter multiplier in [0,1). Injected in tests for determinism. */
  random?: () => number;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 60_000;

/** Transient provider conditions worth another attempt. */
const TRANSIENT_MESSAGE =
  /rate.?limit|overloaded|too many requests|timed? ?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i;

export function isRetryableError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    // The SDK already decided: 429 and 5xx are retryable, 4xx generally isn't.
    if (error.isRetryable) return true;
    const status = error.statusCode;
    return status === 429 || (status !== undefined && status >= 500);
  }

  const status =
    (error as { status?: number; statusCode?: number })?.status ??
    (error as { statusCode?: number })?.statusCode;
  if (status === 429 || (typeof status === "number" && status >= 500)) {
    return true;
  }

  return TRANSIENT_MESSAGE.test(String((error as Error)?.message ?? ""));
}

/** Retry-After in ms. Guessing shorter than the stated window burns another 429. */
export function retryAfterMs(error: unknown): number | null {
  const headers = APICallError.isInstance(error)
    ? error.responseHeaders
    : (error as { responseHeaders?: Record<string, string> })?.responseHeaders;

  const raw =
    headers?.["retry-after"] ??
    headers?.["Retry-After"] ??
    headers?.["retry-after-ms"];
  if (!raw) return null;

  // Seconds (the common form) or an HTTP date.
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures.
 *
 * Non-retryable errors are rethrown immediately — a malformed request or a bad
 * API key will not get better on the third attempt.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === attempts || !isRetryableError(error)) throw error;

      // Full jitter, so a batch hitting the same limit doesn't retry in lockstep.
      const ceiling = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const backoff = Math.floor(random() * ceiling);
      const delayMs = Math.min(
        Math.max(retryAfterMs(error) ?? 0, backoff),
        maxDelayMs,
      );

      opts.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
