import { Composer } from "grammy";
import type { BotContext } from "../types";
import { runAgent } from "../ai/agent";
import { env } from "../../env";

export const aiChatHandler = new Composer<BotContext>();

// Handle @msocietybot mentions
aiChatHandler.on("message:text", async (ctx) => {
  const botUsername = env.TELEGRAM_BOT_USERNAME;
  const text = ctx.message.text;

  if (!text.includes(`@${botUsername}`)) return;

  const query = text.replace(`@${botUsername}`, "").trim();
  if (!query) {
    await ctx.reply("How can I help? Mention me with a question!", {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  const telegramId = String(ctx.from!.id);

  try {
    await ctx.replyWithChatAction("typing");
    const response = await runAgent({ query, telegramId });
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
