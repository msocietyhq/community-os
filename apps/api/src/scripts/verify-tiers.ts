/**
 * Throwaway verification for the runtime model-selection change.
 *
 *   bun run --cwd apps/api src/scripts/verify-tiers.ts          # read-only
 *   bun run --cwd apps/api src/scripts/verify-tiers.ts --live   # spends ~$0.0001
 *
 * Read-only mode touches no provider and writes nothing. `--live` makes one
 * tiny structured-output call on the micro tier and writes one ai_usage row.
 */
import { z } from "zod";
import { AI_TIERS, AI_CATALOG } from "@community-os/shared/ai-catalog";
import { getSettings } from "../services/bot-settings.service";
import { aiService } from "../services/ai.service";
import { estimateCost } from "../services/ai-pricing";

const settings = await getSettings();

console.log("\ntier    catalog key            provider model      in/out $/1M  key?");
console.log("─".repeat(76));

for (const tier of AI_TIERS) {
  const key = settings[`ai.model.${tier}`];
  const def = AI_CATALOG[key];
  const hasKey = Boolean(process.env[def.envKey]);
  console.log(
    `${tier.padEnd(7)} ${key.padEnd(22)} ${def.modelId.padEnd(19)} ` +
      `${String(def.pricing.input).padStart(4)}/${String(def.pricing.output).padEnd(6)} ` +
      `${hasKey ? "yes" : "NO — will fall back"}`,
  );
}

// A model that prices at $0 would silently disable every spend cap.
console.log("\npricing sanity (1M in / 1M out):");
for (const tier of AI_TIERS) {
  const key = settings[`ai.model.${tier}`];
  const cost = estimateCost(key, 1_000_000, 1_000_000);
  console.log(`  ${tier.padEnd(7)} ${key.padEnd(22)} $${cost.toFixed(2)}${cost === 0 ? "  ← BROKEN: caps would not bind" : ""}`);
}

if (process.argv.includes("--live")) {
  console.log("\nlive micro-tier call…");
  const result = await aiService.generateObject(
    {
      schema: z.object({ ok: z.boolean() }),
      prompt: "Reply with ok: true.",
      maxOutputTokens: 64,
    },
    { caller: "verify-tiers", tier: "micro", class: "background" },
  );
  console.log("  returned:", result.object);
  console.log(
    `  usage: ${result.usage.inputTokens ?? 0} in / ${result.usage.outputTokens ?? 0} out`,
  );
  console.log("  → check ai_usage for caller='verify-tiers'");
}

process.exit(0);
