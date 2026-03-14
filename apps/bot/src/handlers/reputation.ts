import { Composer } from "grammy";
import type { BotContext } from "../types";
import { processReaction, processKeyword } from "../lib/reputation";

export const reputationHandler = new Composer<BotContext>();

// Handle emoji reactions
reputationHandler.on("message_reaction", async (ctx) => {
  const reaction = ctx.messageReaction;
  if (!reaction) return;

  const fromUser = reaction.user;
  if (!fromUser || fromUser.is_bot) return;

  for (const emoji of reaction.new_reaction) {
    if (emoji.type === "emoji") {
      await processReaction({
        fromTelegramId: String(fromUser.id),
        messageId: String(reaction.message_id),
        chatId: String(reaction.chat.id),
        emoji: emoji.emoji,
      });
    }
  }
});

// Handle keyword-based reputation (in replies)
reputationHandler.on("message:text", async (ctx, next) => {
  if (ctx.message.reply_to_message) {
    const replyToUser = ctx.message.reply_to_message.from;
    if (replyToUser && !replyToUser.is_bot && replyToUser.id !== ctx.from?.id) {
      await processKeyword({
        fromTelegramId: String(ctx.from!.id),
        toTelegramId: String(replyToUser.id),
        messageId: String(ctx.message.message_id),
        chatId: String(ctx.chat.id),
        text: ctx.message.text,
      });
    }
  }

  await next();
});

// /reputation command
reputationHandler.command("reputation", async (ctx) => {
  // TODO: Fetch reputation from API and display
  await ctx.reply("Your reputation score: coming soon!");
});
