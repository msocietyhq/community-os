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
import {
  GROUP_PROGRESS_CLEAR_MS,
  type ProgressSink,
} from "../lib/subagent-progress";
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
import { renderDraftCard } from "../lib/settings-menu";
import { isPaused } from "@community-os/shared/bot-settings";
import { getSettings } from "../../services/bot-settings.service";
import { inQuietHours } from "../lib/chime-in";
import { shouldSendDenial } from "../lib/dm-access";
import { resolveUser } from "../lib/auth";

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

  const settings = await getSettings();

  if (isPaused(settings["ai.replies"], new Date())) {
    // Admins keep talking to the AI in DMs — otherwise pausing would remove
    // the very channel used to unpause.
    const resolved =
      isPrivate && ctx.from ? await resolveUser(String(ctx.from.id)) : null;
    const role = resolved?.user.role;
    const isAdmin = role === "admin" || role === "superadmin";

    if (!isAdmin) {
      // Group: silent drop, so the bot simply looks offline. DM: a reply,
      // because silence in a one-to-one chat reads as a fault.
      const reply = settings["dm.maintenanceReply"];
      if (
        isPrivate &&
        reply !== null &&
        ctx.from &&
        shouldSendDenial(ctx.from.id)
      ) {
        await ctx.reply(reply);
      }
      return;
    }
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
    async delete(messageId) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, messageId);
      } catch (err) {
        // Already gone, or the bot lost the right to remove it. Neither is
        // worth disturbing the turn over.
        console.error("[subagent-progress] delete failed:", err);
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

  /**
   * Renders an AI-proposed change set as a confirmation card and parks it in
   * the session. Nothing is written until the admin presses Confirm — the
   * card's callbacks are handled by handlers/settings.ts.
   */
  const proposeSettings = async (input: {
    changes: { key: string; from: unknown; to: unknown }[];
    rationale?: string;
  }) => {
    const draft = {
      changes: input.changes,
      rationale: input.rationale,
      createdAt: Date.now(),
      messageId: 0,
    };
    const page = renderDraftCard(draft, []);
    // The page carries its own parse mode, so this can't drift from the
    // renderer again — it once sent HTML as Markdown and showed raw <b> tags.
    const sent = await ctx.reply(page.text, {
      parse_mode: page.parseMode,
      reply_markup: page.keyboard,
    });
    ctx.session.settingsDraft = { ...draft, messageId: sent.message_id };
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
      // An uninvited turn reports nothing. Sub-agents are what post the status
      // message, and the nudge path calls one — so without this the group would
      // get "Members — searching…" followed by no reply at all, which is worse
      // than staying quiet. There is no deletion path to undo it after the fact.
      progressSink: chimingIn ? undefined : progressSink,
      // Groups clean the status message up after the turn; a DM keeps it as
      // history.
      progressClearAfterMs: isGroup ? GROUP_PROGRESS_CLEAR_MS : undefined,
      askUser,
      proposeSettings,
      // DM-only: the group gets the same sub-agent tree, without a running
      // commentary of every lookup the bot makes.
      trackAllTools: isPrivate,
      chimingIn,
      // Deciding whether to speak at all is a harder judgement than answering a
      // question that was actually asked.
      tier: chimingIn ? "smart" : "fast",
    });

    // The agent looked and had nothing worth adding. Send nothing, and don't
    // record a chime — staying quiet must not burn the cooldown that gates
    // speaking.
    if (responseText === null) return;

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
  const settings = await getSettings();

  if (!settings["chimeIn.enabled"]) return false;

  // Quiet hours suppress only uninvited replies — a direct question at 1am
  // still gets an answer, it just doesn't get volunteered.
  if (inQuietHours(settings["availability.quietHours"], new Date(now))) {
    return false;
  }

  const skip = preFilter({ text, isBot: ctx.from?.is_bot ?? false });
  if (skip) return false;

  const cooldownMs = settings["chimeIn.cooldownMinutes"] * 60_000;
  if (!offCooldown(lastChimeAt(chatId), now, cooldownMs)) return false;

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
    minConfidence: settings["chimeIn.minConfidence"],
  });

  // The message text is logged alongside the verdict so real traffic
  // accumulates as a corpus. The judge's prompt is currently far too short to
  // cache on Haiku 4.5 (4096-token minimum); worked examples mined from these
  // lines are what would make a larger prompt worth its cost, and they also
  // back-test the grounding rule. See the design spec.
  console.log(
    `[chime-in] ${decision.respond ? "SPEAK" : "stay quiet"} (${decision.confidence.toFixed(2)}) — ${decision.reason} — "${text.slice(0, 200)}"`,
  );

  return decision.respond;
}
