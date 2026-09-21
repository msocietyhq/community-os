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
import {
  getRecentChatMessages,
  logBotMessage,
} from "../lib/telegram-message-logger";
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
import {
  preFilter as driftPreFilter,
  topicKey,
  recordOffTopic,
  resetStreak,
  lastReminderAt,
  recordReminder,
  renderReminder,
  TOPIC_DRIFT_CONTEXT_MESSAGES,
} from "../lib/topic-drift";
import { judgeTopicDrift } from "../lib/topic-drift-judge";
import { getTopicName } from "../../services/topics.service";
import { policyFor, permittedCallbacks, deliver } from "../lib/turn";
import { toTelegramMarkdown } from "../lib/markdown";
import { renderDraftCard } from "../lib/settings-menu";
import { isPaused } from "@community-os/shared/bot-settings";
import { getSettings } from "../../services/bot-settings.service";
import { inQuietHours } from "../lib/chime-in";
import { shouldSendDenial } from "../lib/dm-access";
import { resolveUser } from "../lib/auth";
import {
  buildConversationContext,
  HISTORY_MESSAGE_LIMIT,
  HISTORY_WINDOW_MS,
  type ChatHistoryFetcher,
  type ConversationMessage,
} from "../lib/conversation-context";
import { getMessagesByIds } from "../../services/messages.service";

type RecentChatMessageRow = Awaited<
  ReturnType<typeof getRecentChatMessages>
>[number];

function rowToConversationMessage(
  row: RecentChatMessageRow,
): ConversationMessage {
  return {
    id: row.messageId,
    text:
      row.text ?? row.caption ?? (row.mediaType ? `[${row.mediaType}]` : ""),
    from: row.fromUsername
      ? `@${row.fromUsername}`
      : (row.fromFirstName ?? "unknown"),
    at: row.date.toISOString(),
    senderId: row.fromUserId ?? undefined,
    ...(row.replyToMessageId == null
      ? {}
      : { replyToId: row.replyToMessageId }),
  };
}

/**
 * Resolves an out-of-window reply parent by primary-key lookup — the same
 * lookup the `chat_history` tool's `message_ids` mode uses. Lets both the
 * main agent and the chime-in judge see a parent that aged out of the
 * rolling window instead of only what Telegram happened to embed inline.
 */
const fetchChatHistory: ChatHistoryFetcher = async (messageId, chatId) => {
  if (chatId === undefined) return null;
  const [message] = await getMessagesByIds(chatId, [messageId]);
  if (!message) return null;
  return {
    id: message.messageId,
    text: message.text ?? "",
    from: message.from,
    at: message.date.toISOString(),
    ...(message.replyToMessageId == null
      ? {}
      : { replyToId: message.replyToMessageId }),
  };
};

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
      return await ctx.reply(markdown, {
        ...options,
        parse_mode: "MarkdownV2",
      });
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
      if (!chimingIn) {
        // A separate judgement from chime-in: not "should the bot answer
        // this", but "has this topic drifted". Only reachable here — a turn
        // the bot is already about to answer or speak in this cycle isn't
        // also a candidate for a drift reminder in the same breath.
        await maybeRemindTopicDrift(ctx, text, now);
        return;
      }
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

  // Settled as soon as we know whether the bot was spoken to. At function
  // scope so the catch block below answers to the same policy.
  const policy = policyFor(chimingIn ? "uninvited" : "addressed");

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
  );

  // Normalize the update and stored rows into one transport-independent context.
  const recentMessages = await getRecentChatMessages(
    String(ctx.chat.id),
    ctx.message.message_thread_id ?? null,
    HISTORY_WINDOW_MS,
    HISTORY_MESSAGE_LIMIT,
    ctx.message.message_id,
  );
  const conversation = await buildConversationContext(
    {
      chatId: String(ctx.chat.id),
      messageId: meta.messageId,
      text: query,
      from: meta.from.username ? `@${meta.from.username}` : meta.from.firstName,
      at: meta.date,
      replyToId: meta.replyTo?.messageId,
      isGroupChat: isGroup,
      topicId: ctx.message.message_thread_id,
    },
    recentMessages.map(rowToConversationMessage),
    fetchChatHistory,
  );
  if (meta.replyTo && !conversation.parentMessage) {
    const replyFrom = meta.replyTo.from;
    conversation.parentMessage = {
      id: meta.replyTo.messageId,
      text: meta.replyTo.text ?? "(non-text message)",
      from: replyFrom?.username
        ? `@${replyFrom.username}`
        : (replyFrom?.firstName ?? "someone"),
      at: new Date(meta.replyTo.date * 1000).toISOString(),
    };
  }
  const enrichedQuery = buildEnrichedQuery(query, conversation);

  // Build ModelMessage[] from DB rows + session AI context
  const aiResponses = ctx.session.aiResponses ?? {};
  const chatHistory = buildMessagesFromHistory(
    conversation,
    ctx.me.id,
    aiResponses,
  );

  // Posts a status message the first time a sub-agent runs long enough to be
  // worth reporting, then edits it in place as each one settles. Failures here
  // must never take down the reply, so every call is swallowed.
  const progressSink: ProgressSink = {
    async send(message) {
      try {
        const msg = await ctx.reply(message.text, {
          entities: message.entities,
        });
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
  const rememberTurn = (
    botMessageId: number,
    turn: (typeof aiResponses)[number],
  ) => {
    aiResponses[botMessageId] = turn;

    const recentBotMessageIds = new Set(
      recentMessages
        .filter((r) => r.fromUserId === ctx.me.id)
        .map((r) => r.messageId),
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
    // Every one of these puts something in the chat, so an uninvited turn is
    // handed none of them. See permittedCallbacks for what that does and does
    // not guarantee about the tools themselves.
    const permitted = permittedCallbacks(policy.kind, {
      progressSink,
      askUser,
      proposeSettings,
    });

    const outcome = await runAgent({
      query,
      enrichedQuery,
      telegramId,
      telegramUser: ctx.from,
      chatHistory,
      chatId: String(ctx.chat.id),
      senderTelegramId: ctx.from?.id ?? null,
      ...permitted,
      // Groups clean the status message up after the turn; a DM keeps it as
      // history. Turns on chat type, not on whether the bot was spoken to —
      // though an uninvited turn has no sink for it to act on anyway.
      progressClearAfterMs: isGroup ? GROUP_PROGRESS_CLEAR_MS : undefined,
      // DM-only: the group gets the same sub-agent tree, without a running
      // commentary of every lookup the bot makes.
      trackAllTools: isPrivate,
      policy,
    });

    // The question is already on screen; a second message would just repeat
    // it. Key this turn to the question so the answer replays with context.
    if (questionMessageId !== null) {
      rememberTurn(questionMessageId, outcome.responseMessages);
      return;
    }

    // The one place anything reaches the chat.
    const delivery = deliver(outcome, policy);
    if (!delivery.send) {
      console.log(`[ai-chat] not sending — ${delivery.reason}`);
      return;
    }

    const sentMsg = await replyFormatted(ctx, delivery.text, {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
    });

    rememberTurn(sentMsg.message_id, outcome.responseMessages);
    if (delivery.recordChime) recordChime(String(ctx.chat.id));
    logBotMessage(sentMsg, ctx.me, chatType, delivery.text);
  } catch (error) {
    console.error("AI chat error:", error);
    // A failure is the bot talking about itself, so it goes through the same
    // rule as any other notice: an uninvited turn stays silent even when it
    // breaks. The member asked the room, not the bot, and has no idea what an
    // apology would even be for.
    const delivery = deliver(
      {
        kind: "notice",
        text: "Sorry, I encountered an error. Please try again later.",
      },
      policy,
    );
    if (!delivery.send) return;
    await ctx.reply(delivery.text, {
      reply_to_message_id: isGroup ? ctx.message.message_id : undefined,
    });
  }
});

/**
 * Fetches recent history and builds the same transcript the main agent path
 * uses — resolved reply parents included, via `buildConversationContext`
 * and `fetchChatHistory`, rather than a hand-built stand-in — for a judge to
 * read. Shared by chime-in and topic-drift, which differ only in how many
 * messages of context they judge with.
 */
async function buildJudgeTranscript(
  ctx: BotContext,
  chatId: string,
  text: string,
  now: number,
  contextMessages: number,
): Promise<string> {
  const recentMessages = await getRecentChatMessages(
    chatId,
    ctx.message!.message_thread_id ?? null,
    ONE_HOUR_MS,
    contextMessages,
    ctx.message!.message_id,
  );

  const conversation = await buildConversationContext(
    {
      chatId,
      messageId: ctx.message!.message_id,
      text,
      from: ctx.from?.username
        ? `@${ctx.from.username}`
        : (ctx.from?.first_name ?? "unknown"),
      at: now,
      replyToId: ctx.message!.reply_to_message?.message_id,
      isGroupChat: true,
      topicId: ctx.message!.message_thread_id,
    },
    recentMessages.map(rowToConversationMessage),
    fetchChatHistory,
  );

  return formatGroupHistory(conversation);
}

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
  const transcript = await buildJudgeTranscript(
    ctx,
    chatId,
    text,
    now,
    CHIME_IN_CONTEXT_MESSAGES,
  );

  const decision = await judgeChimeIn({
    message: text,
    transcript,
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

/**
 * Notices sustained off-topic drift in a forum topic and posts a reminder.
 *
 * Same gate order as chime-in, cheapest first: a free pre-filter, skip
 * anything not a named forum topic, a hard per-topic cooldown, then a Haiku
 * judgement per message that only fires the reminder once it accumulates a
 * long enough consecutive streak. Wrapped so it never throws — a DB hiccup
 * or judge failure here must not take down ordinary chat traffic, so every
 * step degrades to "do nothing" rather than propagating to the handler.
 */
async function maybeRemindTopicDrift(
  ctx: BotContext,
  text: string,
  now: number,
): Promise<void> {
  try {
    await remindOnTopicDrift(ctx, text, now);
  } catch (err) {
    console.error("[topic-drift] failed:", err);
  }
}

async function remindOnTopicDrift(
  ctx: BotContext,
  text: string,
  now: number,
): Promise<void> {
  const threadId = ctx.message?.message_thread_id;
  if (threadId === undefined) return; // not a forum topic message

  const chatId = String(ctx.chat!.id);
  const settings = await getSettings();

  if (!settings["topicDrift.enabled"]) return;

  // Same quiet-hours rule as chime-in: this is the bot volunteering, not
  // answering, so it stays out of the room overnight.
  if (inQuietHours(settings["availability.quietHours"], new Date(now))) {
    return;
  }

  // Free checks first — isBot, command, too-short — before either DB round
  // trip, so ordinary traffic that would be rejected anyway never pays for
  // one.
  const skip = driftPreFilter({ text, isBot: ctx.from?.is_bot ?? false });
  if (skip) return;

  // The cooldown needs only chatId/threadId, not the topic's name — checked
  // before the name lookup so the whole cooldown window (topicDrift.cooldownMinutes,
  // 2 hours by default) skips that query too, not just the reminder send.
  const key = topicKey(chatId, threadId);
  const cooldownMs = settings["topicDrift.cooldownMinutes"] * 60_000;
  if (!offCooldown(lastReminderAt(key), now, cooldownMs)) return;

  const topicName = await getTopicName(chatId, threadId);
  if (topicName === null) return;

  const transcript = await buildJudgeTranscript(
    ctx,
    chatId,
    text,
    now,
    TOPIC_DRIFT_CONTEXT_MESSAGES,
  );

  const decision = await judgeTopicDrift({
    message: text,
    transcript,
    topicName,
    chatId,
    telegramUserId: ctx.from?.id ?? null,
    minConfidence: settings["topicDrift.minConfidence"],
  });

  if (decision === null) {
    // A judge failure says nothing about whether the topic actually came
    // back on subject — leave a build-up streak alone rather than wipe it,
    // so a transient outage can't quietly reset the count mid-derailment.
    return;
  }

  console.log(
    `[topic-drift] ${decision.offTopic ? "off-topic" : "on-topic"} (${decision.confidence.toFixed(2)}) — ${decision.reason} — "${text.slice(0, 200)}"`,
  );

  if (!decision.offTopic) {
    resetStreak(key);
    return;
  }

  const streak = recordOffTopic(key);
  if (streak < settings["topicDrift.consecutiveOffTopic"]) return;

  // Only counted as sent — cooldown started, streak cleared — once the
  // message actually goes out. A failed send leaves the streak at
  // threshold, so the very next off-topic message retries it rather than
  // silencing the topic for a full cooldown window over nothing sent.
  const reminder = renderReminder(
    settings["topicDrift.reminderText"],
    topicName,
  );
  const sent = await ctx.reply(reminder);
  recordReminder(key, now);
  logBotMessage(sent, ctx.me, ctx.chat!.type, reminder);
}
