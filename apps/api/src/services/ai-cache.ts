import type { generateText } from "ai";
import type { ModelDef } from "@community-os/shared/ai-catalog";

type GenerateTextParams = Parameters<typeof generateText>[0];

/**
 * Prompt-cache request shaping.
 *
 * Split out from ai.service so it can be tested directly: that module pulls in
 * the database and `env`, which validates at import time and throws when the
 * test runner hasn't loaded apps/api/.env.
 */

/**
 * A cache write costs 1.25x and a read 0.1x, so caching only pays once a later
 * request re-sends the same prefix. A tool loop does exactly that — every step
 * resends the previous step's prompt — but a one-shot call ends before anything
 * can read what it just wrote, making the write a flat 25% surcharge on its
 * input tokens. So this is scoped to calls that can loop.
 *
 * Requesting it everywhere was the earlier mistake, and it was expensive in the
 * wrong direction: measured on this stack, three identical one-shot profile
 * calls each wrote ~10.6k tokens and read back zero.
 *
 * The breakpoint sits at the end of the prompt (that is what a bare top-level
 * `cacheControl` means), which is right for a growing conversation: step N+1
 * matches the prefix step N wrote. Measured, step 2 of a loop read back 9,918
 * of 9,955 input tokens.
 *
 * Note this cannot help a one-shot caller merely by moving the breakpoint onto
 * the system prompt. Prefixes below the model's minimum do not cache at all —
 * 1024 tokens on Sonnet 5, 4096 on Haiku 4.5 — and the one-shot prompts here
 * are mostly per-row evidence, with stable prefixes under both thresholds.
 *
 * A caller that knows better can still opt in: an explicit `cacheControl` in
 * its own `providerOptions` is left untouched, on either path.
 *
 * Which fragment to merge is the model's business, not this function's: a
 * provider that caches implicitly declares `cacheControl: null` in the catalog
 * and gets nothing added.
 */
export function withPromptCaching(
  params: GenerateTextParams,
  def: ModelDef,
): GenerateTextParams {
  if (def.cacheControl === null) return params;
  if (Object.keys(params.tools ?? {}).length === 0) return params;

  const merged: Record<string, unknown> = { ...params.providerOptions };

  for (const [provider, fragment] of Object.entries(def.cacheControl)) {
    const existing = merged[provider];
    merged[provider] = {
      ...(fragment as Record<string, unknown>),
      ...(typeof existing === "object" && existing !== null ? existing : {}),
    };
  }

  return {
    ...params,
    providerOptions: merged as GenerateTextParams["providerOptions"],
  };
}

/** The cached slices of a call's input tokens, defaulting to none. */
export function cacheSplit(usage: {
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}): { cacheReadTokens: number; cacheWriteTokens: number } {
  return {
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
}
