import { Composer } from "grammy";
import type { BotContext } from "../types";
import { runAgent } from "../ai/agent";
import { env } from "../../env";

const ONE_HOUR_MS = 60 * 60 * 1000;

export const aiChatHandler = new Composer<BotContext>();

aiChatHandler.on("message:text", async (ctx) => {
  const botUsername = env.TELEGRAM_BOT_USERNAME;
  const text = ctx.message.text;
  const chatType = ctx.chat.type;
  const isPrivate = chatType === "private";
  const isGroup = chatType === "group" || chatType === "supergroup";

  // Reject unhandled commands so they don't reach the AI
  if (text.startsWith("/")) {
    await ctx.reply("That's an invalid command. Use /help to see available commands.", {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
    });
    return;
  }

  let query: string;

  if (isGroup) {
    const isMentioned = text.includes(`@${botUsername}`);
    const isReplyToBot =
      ctx.message.reply_to_message?.from?.id === ctx.me.id;

    if (!isMentioned && !isReplyToBot) return;

    query = isMentioned
      ? text.replace(`@${botUsername}`, "").trim()
      : text.trim();

    // When replying to a non-bot message, include the replied-to content
    // so the AI has context (e.g. "@bot can you take a look at this request")
    const replyMsg = ctx.message.reply_to_message;
    if (replyMsg && replyMsg.from?.id !== ctx.me.id) {
      const author =
        replyMsg.from?.first_name ??
        replyMsg.from?.username ??
        "someone";
      const replyText =
        "text" in replyMsg && replyMsg.text
          ? replyMsg.text
          : "(non-text message)";
      query = `[Replying to ${author}: "${replyText}"]\n${query}`;
    }

    if (!query) {
      await ctx.reply("How can I help? Mention me with a question!", {
        reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
      });
      return;
    }
  } else if (isPrivate) {
    query = text.trim();
    if (!query) return;
  } else {
    return;
  }

  const telegramId = String(ctx.from!.id);

  // Reset history if last message was over 1 hour ago
  const now = Date.now();
  if (
    ctx.session.lastMessageAt &&
    now - ctx.session.lastMessageAt > ONE_HOUR_MS
  ) {
    ctx.session.chatHistory = [];
  }

  const chatHistory = ctx.session.chatHistory ?? [];

  try {
    await ctx.replyWithChatAction("typing");
    const { text: responseText, updatedHistory } = await runAgent({
      query,
      telegramId,
      telegramUser: ctx.from!,
      chatHistory,
    });

    ctx.session.chatHistory = updatedHistory;
    ctx.session.lastMessageAt = now;

    await ctx.reply(responseText, {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("AI chat error:", error);
    await ctx.reply(
      "Sorry, I encountered an error. Please try again later.",
      { reply_to_message_id: isGroup ? ctx.message.message_id : undefined },
    );
  }
});
