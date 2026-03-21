import { Composer } from "grammy";
import type { BotContext } from "../types";
import { runAgent } from "../ai/agent";
import { env } from "../../env";
import {
  buildTelegramMeta,
  buildEnrichedQuery,
  buildMessagesFromHistory,
  ONE_HOUR_MS,
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

  const meta = buildTelegramMeta(
    ctx.message,
    ctx.from!,
    chatType as "private" | "group" | "supergroup",
    ctx.me.id,
  );

  const enrichedQuery = buildEnrichedQuery(
    query,
    meta,
    isGroup ? String(ctx.chat.id) : undefined,
  );

  // Fetch recent messages from DB
  const recentMessages = await getRecentChatMessages(
    String(ctx.chat.id),
    ctx.message.message_thread_id,
    ONE_HOUR_MS,
    50,
    ctx.message.message_id, // exclude current (it's in enrichedQuery)
  );

  // Build ModelMessage[] from DB rows + session AI context
  const aiResponses = ctx.session.aiResponses ?? {};
  const chatHistory = buildMessagesFromHistory(recentMessages, ctx.me.id, aiResponses);

  try {
    await ctx.replyWithChatAction("typing");
    const { text: responseText, responseMessages } = await runAgent({
      query: enrichedQuery,
      telegramId,
      telegramUser: ctx.from,
      chatHistory,
    });

    const sentMsg = await ctx.reply(markdownToHtml(responseText), {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
      parse_mode: "HTML",
    });

    // Store AI context in session, keyed by bot message ID
    aiResponses[sentMsg.message_id] = responseMessages;

    // Prune old entries (keep only message IDs present in recent DB rows)
    const recentBotMessageIds = new Set(
      recentMessages.filter((r) => r.fromUserId === ctx.me.id).map((r) => r.messageId),
    );
    recentBotMessageIds.add(sentMsg.message_id);
    for (const key of Object.keys(aiResponses)) {
      if (!recentBotMessageIds.has(Number(key))) {
        delete aiResponses[Number(key)];
      }
    }
    ctx.session.aiResponses = aiResponses;

    logBotMessage(sentMsg, ctx.me, chatType, responseText);
  } catch (error) {
    console.error("AI chat error:", error);
    await ctx.reply("Sorry, I encountered an error. Please try again later.", {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
    });
  }
});
