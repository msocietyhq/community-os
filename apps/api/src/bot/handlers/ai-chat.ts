import { Composer } from "grammy";
import type { BotContext } from "../types";
import { runAgent } from "../ai/agent";
import { env } from "../../env";
import {
  buildTelegramMeta,
  buildEnrichedQuery,
  formatGroupHistory,
  getRecentHistory,
  ONE_HOUR_MS,
  MAX_HISTORY,
} from "../lib/chat-context";
import { getRecentChatMessages, logBotMessage } from "../lib/telegram-message-logger";

// Convert Markdown output from AI into Telegram HTML.
// Escapes HTML entities first, then maps ** / * / _ / ` to tags.
function markdownToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/\*([^*\n]+?)\*/g, "<i>$1</i>")
    .replace(/_([^_\n]+?)_/g, "<i>$1</i>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}

export const aiChatHandler = new Composer<BotContext>();

aiChatHandler.on("message:text", async (ctx) => {
  const botUsername = env.TELEGRAM_BOT_USERNAME;
  const text = ctx.message.text;
  const chatType = ctx.chat.type;
  const isPrivate = chatType === "private";
  const isGroup = chatType === "group" || chatType === "supergroup";

  // Reject unhandled commands so they don't reach the AI
  if (text.startsWith("/")) {
    await ctx.reply(
      "That's an invalid command. Use /help to see available commands.",
      {
        reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
      },
    );
    return;
  }

  let query: string;

  if (isGroup) {
    const isMentioned = text.includes(`@${botUsername}`);
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

    if (!isMentioned && !isReplyToBot) return;

    query = isMentioned
      ? text.replace(`@${botUsername}`, "").trim()
      : text.trim();

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
  const now = Date.now();

  const meta = buildTelegramMeta(
    ctx.message,
    ctx.from!,
    chatType as "private" | "group" | "supergroup",
    ctx.me.id,
  );

  let groupTranscript: string | undefined;
  if (isGroup) {
    const recentMsgs = await getRecentChatMessages(
      String(ctx.chat.id),
      ctx.message.message_thread_id ?? null,
      2 * ONE_HOUR_MS,
      50,
      ctx.message.message_id,
    );
    groupTranscript =
      recentMsgs.length > 0 ? formatGroupHistory(recentMsgs) : undefined;
  }

  const enrichedQuery = buildEnrichedQuery(
    query,
    meta,
    groupTranscript,
    isGroup ? String(ctx.chat.id) : undefined,
  );

  const { recentTurns, chatHistory } = getRecentHistory(
    ctx.session.chatTurns ?? [],
    now,
    ONE_HOUR_MS,
    MAX_HISTORY,
  );

  try {
    await ctx.replyWithChatAction("typing");
    const { text: responseText, updatedHistory } = await runAgent({
      query: enrichedQuery,
      telegramId,
      telegramUser: ctx.from,
      chatHistory,
    });

    const newTurnMessages = updatedHistory.slice(chatHistory.length);
    ctx.session.chatTurns = [
      ...recentTurns,
      { timestamp: now, meta, messages: newTurnMessages },
    ];

    const sentMsg = await ctx.reply(markdownToHtml(responseText), {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
      parse_mode: "HTML",
    });
    logBotMessage(sentMsg, ctx.me, chatType, responseText);
  } catch (error) {
    console.error("AI chat error:", error);
    await ctx.reply("Sorry, I encountered an error. Please try again later.", {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
    });
  }
});
