import { Composer } from "grammy";
import type { BotContext } from "../types";
import { runAgent } from "../ai/agent";
import { env } from "../../env";

export const aiChatHandler = new Composer<BotContext>();

aiChatHandler.on("message:text", async (ctx) => {
  const botUsername = env.TELEGRAM_BOT_USERNAME;
  const text = ctx.message.text;
  const chatType = ctx.chat.type;
  const isPrivate = chatType === "private";
  const isGroup = chatType === "group" || chatType === "supergroup";

  let query: string;

  if (isGroup) {
    const isMentioned = text.includes(`@${botUsername}`);
    const isReplyToBot =
      ctx.message.reply_to_message?.from?.id === ctx.me.id;

    if (!isMentioned && !isReplyToBot) return;

    query = isMentioned
      ? text.replace(`@${botUsername}`, "").trim()
      : text.trim();

    if (!query) {
      await ctx.reply("How can I help? Mention me with a question!", {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }
  } else if (isPrivate) {
    query = text.trim();
    if (!query) return;
  } else {
    return;
  }

  // Extract previous bot message for conversational context
  const previousBotMessage =
    ctx.message.reply_to_message?.from?.id === ctx.me.id
      ? ctx.message.reply_to_message.text
      : undefined;

  const telegramId = String(ctx.from!.id);

  try {
    await ctx.replyWithChatAction("typing");
    const response = await runAgent({ query, telegramId, previousBotMessage });
    await ctx.reply(response, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("AI chat error:", error);
    await ctx.reply("Sorry, I encountered an error. Please try again later.", {
      reply_to_message_id: ctx.message.message_id,
    });
  }
});
