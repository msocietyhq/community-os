import { Composer } from "grammy";
import type { BotContext } from "../types";
import { digestService } from "../../services/digest.service";
import { formatWeeklyDigest } from "../lib/digest-formatter";
import { formatHistoryDigest } from "../lib/history-digest-formatter";

export const digestHandler = new Composer<BotContext>();

digestHandler.command("digest", async (ctx) => {
  const digest = await digestService.generateWeeklyDigest();
  const message = formatWeeklyDigest(digest);

  await ctx.reply(message, { parse_mode: "Markdown" });
});

digestHandler.command("digest_history", async (ctx) => {
  const history = await digestService.getThisWeekInHistory();
  if (!history) {
    await ctx.reply("No historical data found for this week.");
    return;
  }

  const message = formatHistoryDigest(history);

  await ctx.reply(message, { parse_mode: "Markdown" });
});
