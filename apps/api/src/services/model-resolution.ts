import {
  AI_CATALOG,
  AI_TIERS,
  TIER_FALLBACK_ORDER,
  type AiModelKey,
  type AiProvider,
  type AiTier,
} from "@community-os/shared/ai-catalog";

/**
 * Which model a tier actually runs on, given what is usable right now.
 *
 * Pure — the caller decides what "usable" means (an API key present, the
 * provider not out of credit) and this only walks the order. Tested without a
 * database or `env`, like ai-pricing and ai-cache.
 *
 * The selected model is always tried first, whatever its position in the
 * fallback order. Anything else would mean a tier pointed at DeepSeek could
 * quietly run on Anthropic while `/settings` still claimed otherwise.
 *
 * Returns null when nothing is usable. The caller decides how loudly to fail;
 * returning an unusable model would only move the error somewhere less clear.
 */
export function resolveModelKey(input: {
  tier: AiTier;
  selected: AiModelKey;
  isUsable: (key: AiModelKey) => boolean;
}): AiModelKey | null {
  const { tier, selected, isUsable } = input;

  if (isUsable(selected)) return selected;

  for (const candidate of TIER_FALLBACK_ORDER[tier]) {
    if (isUsable(candidate)) return candidate;
  }

  return null;
}

/**
 * Every tier currently pointed at a provider — what an outage on it affects.
 *
 * Pure for the same reason as the above: the caller supplies the selection,
 * which for configurable tiers comes from settings and for `micro` is pinned
 * in the catalog. `micro` is included deliberately — it cannot be changed by
 * an admin, but an outage on its provider still moves it.
 */
export function tiersSelecting(
  provider: AiProvider,
  selectedFor: (tier: AiTier) => AiModelKey,
): AiTier[] {
  return AI_TIERS.filter(
    (tier) => AI_CATALOG[selectedFor(tier)].provider === provider,
  );
}
