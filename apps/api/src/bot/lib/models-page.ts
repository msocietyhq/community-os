import {
  AI_CATALOG,
  AI_PROVIDERS,
  AI_TIERS,
  isConfigurableTier,
  type AiModelKey,
  type AiTier,
} from "@community-os/shared/ai-catalog";
import { escapeHtml } from "./telegram-html";

export interface ModelsPageInput {
  /** Which model each tier is currently pointed at. */
  tierModels: Record<AiTier, AiModelKey>;
  /** Models whose provider key is actually present in this deployment. */
  configured: readonly AiModelKey[];
}

/** `$1.00`, `$0.44` — always two decimals so the columns line up. */
const usd = (v: number) => `$${v.toFixed(2)}`;

/**
 * The full catalog, grouped by provider.
 *
 * Shows the catalog key rather than only the label because the key is what a
 * settings change actually takes — the label alone ("Opus 5") is not a value
 * anything accepts.
 */
export function renderModelsPage(input: ModelsPageInput): string {
  const configured = new Set(input.configured);

  // Only tiers someone can actually change. Pinned tiers are an internal
  // routing detail — naming them here would invite a request to change
  // something that has no control.
  const usedBy = (key: AiModelKey): AiTier[] =>
    AI_TIERS.filter(
      (t) => isConfigurableTier(t) && input.tierModels[t] === key,
    );

  const sections = AI_PROVIDERS.map((provider) => {
    const keys = (Object.keys(AI_CATALOG) as AiModelKey[]).filter(
      (k) => AI_CATALOG[k].provider === provider,
    );

    const entries = keys.map((key) => {
      const def = AI_CATALOG[key];
      const tiers = usedBy(key);

      const status = [
        tiers.length > 0 ? `in use: ${tiers.join(", ")}` : null,
        configured.has(key) ? null : `${def.envKey} not set`,
      ].filter(Boolean);

      return (
        `<b>${escapeHtml(def.label)}</b>\n` +
        `<code>${escapeHtml(key)}</code> → <code>${escapeHtml(def.modelId)}</code>\n` +
        `${usd(def.pricing.input)} in / ${usd(def.pricing.output)} out per 1M` +
        (status.length > 0 ? `\n<i>${escapeHtml(status.join(" · "))}</i>` : "")
      );
    });

    return `<b>${escapeHtml(provider.toUpperCase())}</b>\n\n${entries.join("\n\n")}`;
  });

  return (
    `<b>Available models</b>\n\n` +
    `${sections.join("\n\n")}\n\n` +
    `<i>Change a tier from /settings → Cost. Prices are list rates; ` +
    `providers with time-of-day pricing are recorded at their peak rate so ` +
    `spend caps bind early rather than late.</i>`
  );
}
