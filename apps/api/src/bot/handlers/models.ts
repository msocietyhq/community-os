import { Composer } from "grammy";
import {
  AI_CATALOG,
  AI_TIERS,
  type AiModelKey,
  type AiTier,
} from "@community-os/shared/ai-catalog";
import type { BotContext } from "../types";
import { getSettings } from "../../services/bot-settings.service";
import { hasCredentials } from "../../services/ai-provider";
import { renderModelsPage } from "../lib/models-page";

export const modelsHandler = new Composer<BotContext>();

/**
 * Lists the model catalog: what each tier runs on, and what else it could run
 * on. Read-only — changing a tier goes through /settings, which is admin-only.
 */
modelsHandler.command("models", async (ctx) => {
  const settings = await getSettings();

  const tierModels = Object.fromEntries(
    AI_TIERS.map((tier) => [tier, settings[`ai.model.${tier}`]]),
  ) as Record<AiTier, AiModelKey>;

  const configured = (Object.keys(AI_CATALOG) as AiModelKey[]).filter(
    hasCredentials,
  );

  await ctx.reply(renderModelsPage({ tierModels, configured }), {
    parse_mode: "HTML",
  });
});
