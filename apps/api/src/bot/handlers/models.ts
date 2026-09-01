import { Composer } from "grammy";
import {
  AI_CATALOG,
  AI_TIERS,
  type AiModelKey,
  type AiTier,
} from "@community-os/shared/ai-catalog";
import type { BotContext } from "../types";
import { currentModelFor } from "../../services/ai.service";
import { hasCredentials } from "../../services/ai-provider";
import { renderModelsPage } from "../lib/models-page";

export const modelsHandler = new Composer<BotContext>();

/**
 * Lists the model catalog: what each tier runs on, and what else it could run
 * on. Read-only — changing a tier goes through /settings, which is admin-only.
 */
modelsHandler.command("models", async (ctx) => {
  // Resolved through the service so pinned tiers (which have no settings row)
  // and configurable ones are read the same way.
  const resolved = await Promise.all(
    AI_TIERS.map(
      async (tier) => [tier, (await currentModelFor(tier)).key] as const,
    ),
  );
  const tierModels = Object.fromEntries(resolved) as Record<AiTier, AiModelKey>;

  const configured = (Object.keys(AI_CATALOG) as AiModelKey[]).filter(
    hasCredentials,
  );

  await ctx.reply(renderModelsPage({ tierModels, configured }), {
    parse_mode: "HTML",
  });
});
