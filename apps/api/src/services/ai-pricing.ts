/**
 * Model ids and token pricing.
 *
 * Split out from ai.service so the arithmetic can be tested directly: that
 * module pulls in the database and `env`, which validates at import time and
 * throws when the test runner hasn't loaded apps/api/.env.
 */

export const AI_MODEL_IDS = {
  fast: "claude-haiku-4-5",
  smart: "claude-sonnet-5",
  deep: "claude-opus-5",
} as const;

/**
 * Price per 1M tokens, in USD. Update when pricing changes.
 *
 * A model missing from this map is costed at $0, which would silently defeat
 * the advisor spend cap — add an entry whenever a model is added above.
 * Sonnet 5 has promotional pricing ($2/$10) through 2026-08-31; standard rates
 * are used here so budgets don't under-count once it ends.
 */
export const AI_MODEL_PRICING: Record<
  string,
  { input: number; output: number }
> = {
  [AI_MODEL_IDS.fast]: { input: 1.0, output: 5.0 },
  [AI_MODEL_IDS.smart]: { input: 3.0, output: 15.0 },
  [AI_MODEL_IDS.deep]: { input: 5.0, output: 25.0 },

  // Retired ids that ai_usage rows still reference. Without these, historical
  // spend silently reports as $0 — renaming a model must not rewrite the past.
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
};

/**
 * Anthropic bills a cache read at ~0.1x the input rate and a cache write at
 * 1.25x (the 5-minute TTL this code uses; a 1-hour TTL would be 2x).
 */
export const CACHE_READ_RATE = 0.1;
export const CACHE_WRITE_RATE = 1.25;

/**
 * `inputTokens` is the whole prompt; `cacheRead`/`cacheWrite` are slices of it,
 * so the remainder is what was billed at the base rate. Pricing the whole
 * prompt at 1.0x — as this did before — over-charges reads by 10x and
 * under-charges writes by a quarter, which quietly moves the budget caps.
 *
 * Both cache arguments default to 0 so rows written before those columns
 * existed price exactly as they did then.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const pricing = AI_MODEL_PRICING[model];
  if (!pricing) return 0;

  const uncachedTokens = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheWriteTokens,
  );

  const inputUnits =
    uncachedTokens +
    cacheReadTokens * CACHE_READ_RATE +
    cacheWriteTokens * CACHE_WRITE_RATE;

  return (
    (inputUnits * pricing.input + outputTokens * pricing.output) / 1_000_000
  );
}
