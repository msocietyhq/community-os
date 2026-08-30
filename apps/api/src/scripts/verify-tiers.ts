/**
 * Pre-deploy sanity check for runtime model selection.
 *
 *   bun run --cwd apps/api src/scripts/verify-tiers.ts            # read-only
 *   bun run --cwd apps/api src/scripts/verify-tiers.ts --live     # one call on each tier's model
 *   bun run --cwd apps/api src/scripts/verify-tiers.ts --probe    # one call on EVERY catalog model
 *
 * Read-only mode contacts no provider and writes nothing.
 *
 * `--live` goes through the tracked service, so it exercises the real path —
 * budget gate, usage tracking, an ai_usage row per call.
 *
 * `--probe` calls each model directly instead, bypassing the budget gate and
 * writing no ai_usage rows. That is deliberate: it answers "does this model
 * work with our schemas at all" without polluting spend history with
 * diagnostics. Both cost a fraction of a cent per model.
 */
import { generateObject } from "ai";
import { z } from "zod";
import {
  AI_CATALOG,
  AI_TIERS,
  isConfigurableTier,
  type AiModelKey,
  type AiTier,
} from "@community-os/shared/ai-catalog";
import { aiService, currentModelFor } from "../services/ai.service";
import { estimateCost } from "../services/ai-pricing";
import { hasCredentials, modelFor } from "../services/ai-provider";

const PROBE_SCHEMA = z.object({ ok: z.boolean() });
const PROBE_PROMPT = "Reply with ok: true.";

const live = process.argv.includes("--live");
const probe = process.argv.includes("--probe");

// ── Tier configuration ──────────────────────────────────────

const tierKeys = new Map<AiTier, AiModelKey>();
for (const tier of AI_TIERS) {
  tierKeys.set(tier, (await currentModelFor(tier)).key);
}
const keyOf = (tier: AiTier): AiModelKey => tierKeys.get(tier) as AiModelKey;

console.log("\ntier    catalog key            provider model      in/out $/1M  settable  key?");
console.log("─".repeat(88));

for (const tier of AI_TIERS) {
  const key = keyOf(tier);
  const def = AI_CATALOG[key];
  console.log(
    `${tier.padEnd(7)} ${key.padEnd(22)} ${def.modelId.padEnd(19)} ` +
      `${String(def.pricing.input).padStart(4)}/${String(def.pricing.output).padEnd(6)} ` +
      `${(isConfigurableTier(tier) ? "yes" : "PINNED").padEnd(9)} ` +
      `${hasCredentials(key) ? "yes" : "NO — falls back to default"}`,
  );
}

// A model priced at $0 would silently disable every spend cap.
console.log("\npricing sanity (1M in / 1M out):");
for (const tier of AI_TIERS) {
  const key = keyOf(tier);
  const cost = estimateCost(key, 1_000_000, 1_000_000);
  console.log(
    `  ${tier.padEnd(7)} ${key.padEnd(22)} $${cost.toFixed(2)}` +
      (cost === 0 ? "  ← BROKEN: caps would not bind" : ""),
  );
}

// What the chat agent is told about itself. If this disagrees with the `fast`
// row above, the agent will misreport its own model — the bug this guards.
const running = await aiService.currentModelFor("fast");
console.log(
  `\nagent identity: "You are running on ${running.key} (${running.label})."`,
);

// ── Live call through the tracked service ───────────────────

if (live) {
  for (const tier of AI_TIERS) {
    const key = keyOf(tier);
    const started = performance.now();
    try {
      const result = await aiService.generateObject(
        { schema: PROBE_SCHEMA, prompt: PROBE_PROMPT, maxOutputTokens: 64 },
        { caller: "verify-tiers", tier, class: "background" },
      );
      const ms = Math.round(performance.now() - started);
      const usage = result.usage;
      const inTok = usage.inputTokens ?? 0;
      const outTok = usage.outputTokens ?? 0;
      console.log(
        `\n${tier}: ok — ${JSON.stringify(result.object)} · ${inTok} in / ${outTok} out · ${ms}ms` +
          (inTok === 0
            ? "\n  ⚠ usage came back empty — cost tracking would read $0 and the caps would stop binding"
            : ""),
      );
    } catch (err) {
      console.log(
        `\n${tier}: FAILED (${key}) — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log("\n→ rows written to ai_usage with caller='verify-tiers'");
}

// ── Direct probe of every catalog model ─────────────────────

if (probe) {
  console.log("\nprobing every catalog model directly (no budget gate, no ai_usage):");
  for (const key of Object.keys(AI_CATALOG) as AiModelKey[]) {
    const def = AI_CATALOG[key];

    if (!hasCredentials(key)) {
      console.log(`  ${key.padEnd(22)} skipped — ${def.envKey} not set`);
      continue;
    }

    const started = performance.now();
    try {
      const result = await generateObject({
        model: modelFor(key),
        schema: PROBE_SCHEMA,
        prompt: PROBE_PROMPT,
        maxOutputTokens: 64,
      });
      const ms = Math.round(performance.now() - started);
      const inTok = result.usage.inputTokens ?? 0;
      const outTok = result.usage.outputTokens ?? 0;
      const cost = estimateCost(key, inTok, outTok);
      console.log(
        `  ${key.padEnd(22)} ok  ${String(inTok).padStart(5)} in / ${String(outTok).padStart(4)} out  ` +
          `${String(ms).padStart(6)}ms  $${cost.toFixed(6)}` +
          (inTok === 0 ? "  ⚠ NO USAGE REPORTED" : ""),
      );
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      console.log(
        `  ${key.padEnd(22)} FAIL ${String(ms).padStart(5)}ms  ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`,
      );
    }
  }
}

process.exit(0);
