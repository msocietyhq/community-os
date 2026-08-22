import { Composer } from "grammy";
import type { BotContext } from "../types";
import { runAgent } from "../ai/agent";
import { env } from "../../env";
import {
  formatGroupHistory,
  buildTelegramMeta,
  buildEnrichedQuery,
  buildMessagesFromHistory,
  ONE_HOUR_MS,
} from "../lib/chat-context";
import { getRecentChatMessages, logBotMessage } from "../lib/telegram-message-logger";
import type { ProgressSink } from "../lib/subagent-progress";
import { shouldResume, isExpired } from "../lib/pending-question";
import {
  preFilter,
  offCooldown,

  recordChime,
  lastChimeAt,
  CHIME_IN_CONTEXT_MESSAGES,
} from "../lib/chime-in";
import { judgeChimeIn } from "../lib/chime-in-judge";
import { toTelegramMarkdown } from "../lib/markdown";

export const aiChatHandler = new Composer<BotContext>();

/**
 * Send model output as MarkdownV2, falling back to plain text if Telegram
 * rejects it.
 *
 * Telegram refuses a whole message when a parse mode doesn't validate, so a
 * single formatting edge case would otherwise turn a good answer into nothing
 * at all. The retry drops formatting rather than the reply.
 */
async function replyFormatted(
  ctx: BotContext,
  text: string,
  options: Parameters<BotContext["reply"]>[1] = {},
) {
  const markdown = toTelegramMarkdown(text);

  if (markdown !== null) {
    try {
      return await ctx.reply(markdown, { ...options, parse_mode: "MarkdownV2" });
    } catch (err) {
      console.error("[ai-chat] MarkdownV2 rejected, sending plain:", err);
    }
  }

  // No parse mode, so the original text needs no escaping of any kind.
  return await ctx.reply(text, options);
}

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

  // Answering an outstanding question counts as addressing the bot, even
  // without a mention or reply. See lib/pending-question.
  const now = Date.now();
  const resuming = shouldResume(ctx.session.pendingQuestion, {
    fromTelegramId: ctx.from?.id ?? null,
    messageThreadId: ctx.message.message_thread_id ?? null,
    at: now,
  });

  if (isExpired(ctx.session.pendingQuestion, now)) {
    ctx.session.pendingQuestion = undefined;
  }

  let chimingIn = false;

  if (isGroup) {
    const isMentioned = text.includes(`@${botUsername}`);
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

    if (!isMentioned && !isReplyToBot && !resuming) {
      chimingIn = await shouldChimeIn(ctx, text, now);
      if (!chimingIn) return;
    }

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

  // Whatever happens next, the question has had its answer (or been ignored
  // in favour of something else) — don't let it linger and catch a later message.
  if (ctx.session.pendingQuestion?.askedTelegramId === ctx.from?.id) {
    ctx.session.pendingQuestion = undefined;
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

  // Fetch recent messages from DB.
  // `message_thread_id` is undefined outside forum topics; coerce to null so
  // General-topic messages are scoped to General rather than skipping the
  // thread filter entirely and pulling in every topic's chatter.
  const recentMessages = await getRecentChatMessages(
    String(ctx.chat.id),
    ctx.message.message_thread_id ?? null,
    ONE_HOUR_MS,
    50,
    ctx.message.message_id, // exclude current (it's in enrichedQuery)
  );

  // Build ModelMessage[] from DB rows + session AI context
  const aiResponses = ctx.session.aiResponses ?? {};
  const chatHistory = buildMessagesFromHistory(recentMessages, ctx.me.id, aiResponses);

  // Posts a status message the first time a sub-agent runs long enough to be
  // worth reporting, then edits it in place as each one settles. Failures here
  // must never take down the reply, so every call is swallowed.
  const progressSink: ProgressSink = {
    async send(message) {
      try {
        const msg = await ctx.reply(message.text, { entities: message.entities });
        return msg.message_id;
      } catch (err) {
        console.error("[subagent-progress] send failed:", err);
        return null;
      }
    },
    async edit(messageId, message) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, messageId, message.text, {
          entities: message.entities,
        });
      } catch (err) {
        console.error("[subagent-progress] edit failed:", err);
      }
    },
  };

  // force_reply pops the reply composer on the asked member's client, so their
  // answer is mechanically a reply to the bot. Without it, a plain follow-up in
  // a group never reaches the handler — it isn't a mention or a reply.
  let questionMessageId: number | null = null;
  const askUser = async (question: string) => {
    const sent = await replyFormatted(ctx, question, {
      reply_markup: { force_reply: true, selective: true },
    });
    questionMessageId = sent.message_id;
    if (ctx.from) {
      ctx.session.pendingQuestion = {
        questionMessageId: sent.message_id,
        askedTelegramId: ctx.from.id,
        askedAt: Date.now(),
        messageThreadId: ctx.message.message_thread_id ?? null,
      };
    }
    logBotMessage(sent, ctx.me, chatType, question);
  };

  /** Keys this turn's AI context to the bot message it produced, then prunes. */
  const rememberTurn = (botMessageId: number, turn: typeof aiResponses[number]) => {
    aiResponses[botMessageId] = turn;

    const recentBotMessageIds = new Set(
      recentMessages.filter((r) => r.fromUserId === ctx.me.id).map((r) => r.messageId),
    );
    recentBotMessageIds.add(botMessageId);
    for (const key of Object.keys(aiResponses)) {
      if (!recentBotMessageIds.has(Number(key))) {
        delete aiResponses[Number(key)];
      }
    }
    ctx.session.aiResponses = aiResponses;
  };

  try {
    await ctx.replyWithChatAction("typing");
    const { text: responseText, responseMessages } = await runAgent({
      query,
      enrichedQuery,
      telegramId,
      telegramUser: ctx.from,
      chatHistory,
      chatId: String(ctx.chat.id),
      senderTelegramId: ctx.from?.id ?? null,
      progressSink,
      askUser,
    });

    // The question is already on screen; a second message would just repeat
    // it. Key this turn to the question so the answer replays with context.
    if (questionMessageId !== null) {
      rememberTurn(questionMessageId, responseMessages);
      return;
    }

    const sentMsg = await replyFormatted(ctx, responseText, {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
    });

    rememberTurn(sentMsg.message_id, responseMessages);
    if (chimingIn) recordChime(String(ctx.chat.id));
    logBotMessage(sentMsg, ctx.me, chatType, responseText);
  } catch (error) {
    console.error("AI chat error:", error);
    await ctx.reply("Sorry, I encountered an error. Please try again later.", {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
    });
  }
});

/**
 * Three gates in series, cheapest first: a free pre-filter, a hard cooldown
 * that no model can override, then a Haiku judgement with conversation
 * context. Any failure resolves to silence.
 */
async function shouldChimeIn(
  ctx: BotContext,
  text: string,
  now: number,
): Promise<boolean> {
  const chatId = String(ctx.chat!.id);

  const skip = preFilter({ text, isBot: ctx.from?.is_bot ?? false });
  if (skip) return false;

  if (!offCooldown(lastChimeAt(chatId), now)) return false;

  // Judged with surrounding conversation — "yeah probably" is unjudgeable alone.
  const context = await getRecentChatMessages(
    chatId,
    ctx.message!.message_thread_id ?? null,
    ONE_HOUR_MS,
    CHIME_IN_CONTEXT_MESSAGES,
    ctx.message!.message_id,
  );

  const decision = await judgeChimeIn({
    message: text,
    transcript: formatGroupHistory(context),
    chatId,
    telegramUserId: ctx.from?.id ?? null,
  });

  console.log(
    `[chime-in] ${decision.respond ? "SPEAK" : "stay quiet"} (${decision.confidence.toFixed(2)}) — ${decision.reason}`,
  );

  return decision.respond;
}
