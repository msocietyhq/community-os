import { Composer } from "grammy";
import type { FormattedString } from "@grammyjs/parse-mode";
import type { BotContext } from "../types";
import { digestService } from "../../services/digest.service";
import { getWeeklyTechNews } from "../../services/tech-news.service";
import { formatMonthlyDigest } from "../lib/digest-formatter";
import { formatHistoryDigest } from "../lib/history-digest-formatter";
import { formatTechNews } from "../lib/tech-news-formatter";

export const digestHandler = new Composer<BotContext>();

/** Entities instead of a parse mode, so nothing in the text needs escaping. */
function replyWith(ctx: BotContext, message: FormattedString) {
  return ctx.reply(message.text, {
    entities: message.entities,
    link_preview_options: { is_disabled: true },
  });
}

digestHandler.command("digest", async (ctx) => {
  // No period argument: the on-demand view is the month so far, not the closed
  // month the scheduled post reports.
  const digest = await digestService.generateMonthlyDigest();
  await replyWith(ctx, formatMonthlyDigest(digest));
});

digestHandler.command("digest_history", async (ctx) => {
  const history = await digestService.getThisMonthInHistory();
  if (!history) {
    await ctx.reply("Nothing from this month in past years is worth resurfacing.");
    return;
  }

  await replyWith(ctx, formatHistoryDigest(history));
});

digestHandler.command("technews", async (ctx) => {
  // Cached per SGT day, so repeat calls are free and consistent with whatever
  // was broadcast. `/technews refresh` forces a regeneration.
  const force = ctx.match?.trim().toLowerCase() === "refresh";
  const news = await getWeeklyTechNews({ force });
  if (!news) {
    await ctx.reply("Couldn't find anything worth reading this week.");
    return;
  }

  // Sent in order — a roundup split mid-section reads backwards otherwise.
  for (const part of formatTechNews(news)) {
    await replyWith(ctx, part);
  }
});
