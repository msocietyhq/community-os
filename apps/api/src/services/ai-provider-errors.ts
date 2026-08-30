import { APICallError } from "ai";

/**
 * Whether a thrown error means "this provider's prepaid balance is empty".
 *
 * Deliberately free of database and env imports so it can be tested without
 * either, like ai-pricing and ai-cache.
 *
 * Only `out_of_credit` triggers failover. Everything else — rate limits, 5xx,
 * bad keys — propagates unchanged to `lib/retry.ts` and the existing error
 * paths. The distinction matters most for OpenAI, where an empty account and
 * an ordinary throttle share status 429 and differ only by error code.
 */
export type ProviderErrorKind = "out_of_credit" | "other";

/** Anthropic 400 and DeepSeek 402 both say so in the message. */
const CREDIT_MESSAGE = /credit balance is too low|insufficient balance/i;

/** OpenAI signals an empty account with this code on a 429. */
const QUOTA_CODE = /"(?:code|type)"\s*:\s*"insufficient_quota"/;

export function classifyProviderError(error: unknown): ProviderErrorKind {
  if (!APICallError.isInstance(error)) return "other";

  const status = error.statusCode;
  if (status !== 400 && status !== 402 && status !== 429) return "other";

  const body = typeof error.responseBody === "string" ? error.responseBody : "";

  if (status === 429) {
    // Status alone is ambiguous here, so the code is the whole signal.
    return QUOTA_CODE.test(body) ? "out_of_credit" : "other";
  }

  return CREDIT_MESSAGE.test(error.message) || CREDIT_MESSAGE.test(body)
    ? "out_of_credit"
    : "other";
}
