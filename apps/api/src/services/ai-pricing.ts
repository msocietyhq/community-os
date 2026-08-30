/**
 * Token pricing.
 *
 * Split out from ai.service so the arithmetic can be tested directly: that
 * module pulls in the database and `env`, which validates at import time and
 * throws when the test runner hasn't loaded apps/api/.env.
 *
 * Live rates come from the shared catalog. This module only adds the legacy
 * table: `ai_usage` rows written before the catalog existed are keyed by raw
 * provider ids, and renaming a model must not rewrite the past.
 */

import { AI_CATALOG } from "@community-os/shared/ai-catalog";

interface Rate {
  input: number;
  output: number;
  cache: { read: number; write: number };
}

/** Anthropic bills a cache read at 0.1x and a 5-minute write at 1.25x. */
const ANTHROPIC_CACHE = { read: 0.1, write: 1.25 };

/**
 * Raw provider ids that historical `ai_usage` rows still reference. Without
 * these, past spend silently reports as $0 in the usage views.
 */
const LEGACY_RATES: Record<string, Rate> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cache: ANTHROPIC_CACHE },
  "claude-sonnet-5": { input: 3.0, output: 15.0, cache: ANTHROPIC_CACHE },
  "claude-opus-5": { input: 5.0, output: 25.0, cache: ANTHROPIC_CACHE },
  "claude-haiku-4-5-20251001": {
    input: 1.0,
    output: 5.0,
    cache: ANTHROPIC_CACHE,
  },
  "claude-sonnet-4-20250514": {
    input: 3.0,
    output: 15.0,
    cache: ANTHROPIC_CACHE,
  },
  "claude-sonnet-4-5-20250929": {
    input: 3.0,
    output: 15.0,
    cache: ANTHROPIC_CACHE,
  },
};

function rateFor(model: string): Rate | null {
  const entry = AI_CATALOG[model as keyof typeof AI_CATALOG];
  if (entry) {
    return {
      input: entry.pricing.input,
      output: entry.pricing.output,
      cache: entry.cache,
    };
  }
  return LEGACY_RATES[model] ?? null;
}

/**
 * `inputTokens` is the whole prompt; `cacheRead`/`cacheWrite` are slices of it,
 * so the remainder is what was billed at the base rate. Pricing the whole
 * prompt at 1.0x over-charges reads by 10x and under-charges writes by a
 * quarter, which quietly moves the budget caps.
 *
 * Both cache arguments default to 0 so rows written before those columns
 * existed price exactly as they did then.
 *
 * A model in neither table is costed at $0. That would defeat the spend caps,
 * so it must stay unreachable: every tier setting is an enum over the catalog,
 * and the catalog is the only way a new model can be selected.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const rate = rateFor(model);
  if (!rate) return 0;

  const uncachedTokens = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheWriteTokens,
  );

  const inputUnits =
    uncachedTokens +
    cacheReadTokens * rate.cache.read +
    cacheWriteTokens * rate.cache.write;

  return (inputUnits * rate.input + outputTokens * rate.output) / 1_000_000;
}
