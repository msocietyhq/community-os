import { Composer } from "grammy";
import type { BotContext } from "../types";
import { digestService } from "../../services/digest.service";
import { formatWeeklyDigest } from "../lib/digest-formatter";

export const digestHandler = new Composer<BotContext>();

digestHandler.command("digest", async (ctx) => {
  const digest = await digestService.generateWeeklyDigest();
  const message = formatWeeklyDigest(digest);

  await ctx.reply(message, { parse_mode: "Markdown" });
});
