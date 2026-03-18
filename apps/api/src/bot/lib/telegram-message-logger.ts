import type { MiddlewareFn } from "grammy";
import type { Message, UserFromGetMe } from "grammy/types";
import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "../../db";
import { telegramMessages } from "../../db/schema/bot";
import type { BotContext } from "../types";

type MediaType =
  | "photo"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "voice"
  | "animation"
  | "video_note"
  | "location"
  | "poll"
  | "contact"
  | "dice"
  | "game"
  | "story"
  | "paid_media";

function detectMediaType(
  msg: NonNullable<BotContext["message"]>,
): MediaType | null {
  if (msg.photo) return "photo";
  if (msg.video) return "video";
  if (msg.audio) return "audio";
  if (msg.document) return "document";
  if (msg.sticker) return "sticker";
  if (msg.voice) return "voice";
  if (msg.animation) return "animation";
  if (msg.video_note) return "video_note";
  if (msg.location) return "location";
  if (msg.poll) return "poll";
  if (msg.contact) return "contact";
  if (msg.dice) return "dice";
  if (msg.game) return "game";
  if ("story" in msg && msg.story) return "story";
  if ("paid_media" in msg && msg.paid_media) return "paid_media";
  return null;
}

/**
 * Middleware that persists all incoming messages to the telegram_messages table.
 * Fire-and-forget — does not block the handler chain.
 */
export const telegramMessageLoggerMiddleware: MiddlewareFn<BotContext> = async (
  ctx,
  next,
) => {
  await next();

  const msg = ctx.message;
  if (!msg || !ctx.chat) return;

  const chat = ctx.chat;
  const from = msg.from;
  const senderChat = msg.sender_chat;
  const forwardOrigin =
    "forward_origin" in msg ? (msg.forward_origin as Record<string, unknown> | undefined) : undefined;
  const mediaType = detectMediaType(msg);

  const row: typeof telegramMessages.$inferInsert = {
    chatId: String(chat.id),
    chatType: chat.type,
    messageId: msg.message_id,
    messageThreadId: msg.message_thread_id ?? null,
    isTopicMessage: msg.is_topic_message ?? null,
    isAutomaticForward: msg.is_automatic_forward ?? null,

    fromUserId: from?.id ?? null,
    fromFirstName: from?.first_name ?? null,
    fromLastName: from?.last_name ?? null,
    fromUsername: from?.username ?? null,
    fromIsBot: from?.is_bot ?? false,
    fromIsPremium: ("is_premium" in (from ?? {}) ? ((from as unknown as Record<string, unknown>)?.is_premium) : null) as boolean | null,
    fromLanguageCode: from?.language_code ?? null,

    senderChatId: senderChat?.id ?? null,
    senderChatUsername: senderChat && "username" in senderChat ? (senderChat.username as string) : null,
    senderChatTitle: senderChat && "title" in senderChat ? (senderChat.title as string) : null,
    authorSignature: "author_signature" in msg ? (msg.author_signature as string) : null,

    text: msg.text ?? null,
    caption: msg.caption ?? null,
    mediaType,
    entities: msg.entities ? (msg.entities as unknown as Record<string, unknown>[]) : null,
    captionEntities: msg.caption_entities ? (msg.caption_entities as unknown as Record<string, unknown>[]) : null,

    replyToMessageId: msg.reply_to_message?.message_id ?? null,
    externalReplyChatId:
      "external_reply" in msg && msg.external_reply
        ? String((msg.external_reply as { chat?: { id: number } }).chat?.id ?? "")
        : null,

    forwardOriginType: forwardOrigin ? (forwardOrigin.type as string) : null,
    forwardFromUserId:
      forwardOrigin?.type === "user"
        ? ((forwardOrigin.sender_user as { id: number })?.id ?? null)
        : null,
    forwardFromFirstName:
      forwardOrigin?.type === "user"
        ? ((forwardOrigin.sender_user as { first_name: string })?.first_name ?? null)
        : forwardOrigin?.type === "hidden_user"
          ? (forwardOrigin.sender_user_name as string ?? null)
          : null,
    forwardFromUsername:
      forwardOrigin?.type === "user"
        ? ((forwardOrigin.sender_user as { username?: string })?.username ?? null)
        : null,
    forwardFromChatId:
      forwardOrigin?.type === "chat" || forwardOrigin?.type === "channel"
        ? ((forwardOrigin.chat as { id: number })?.id ?? null)
        : null,
    forwardFromChatTitle:
      forwardOrigin?.type === "chat" || forwardOrigin?.type === "channel"
        ? ((forwardOrigin.chat as { title?: string })?.title ?? null)
        : null,
    forwardDate: forwardOrigin?.date
      ? new Date((forwardOrigin.date as number) * 1000)
      : null,

    viaBotId: msg.via_bot?.id ?? null,
    businessConnectionId:
      "business_connection_id" in msg
        ? (msg.business_connection_id as string)
        : null,

    pollId: msg.poll?.id ?? null,
    pollQuestion: msg.poll?.question ?? null,

    editDate: msg.edit_date ? new Date(msg.edit_date * 1000) : null,

    newChatMemberIds: msg.new_chat_members
      ? (msg.new_chat_members.map((m) => m.id) as unknown as Record<string, unknown>[])
      : null,
    leftChatMemberUserId: msg.left_chat_member?.id ?? null,
    newChatTitle: msg.new_chat_title ?? null,
    pinnedMessageId: msg.pinned_message?.message_id ?? null,

    date: new Date(msg.date * 1000),
    raw: msg as unknown as Record<string, unknown>,
  };

  db.insert(telegramMessages)
    .values(row)
    .onConflictDoNothing()
    .catch((err: unknown) => {
      console.error("[message-logger] failed to persist message:", err);
    });
};

/**
 * Logs a bot-sent AI response to the telegram_messages table.
 * Fire-and-forget — does not block the caller.
 */
export function logBotMessage(
  sentMessage: Message,
  botInfo: UserFromGetMe,
  chatType: string,
  responseText: string,
): void {
  const row: typeof telegramMessages.$inferInsert = {
    chatId: String(sentMessage.chat.id),
    chatType,
    messageId: sentMessage.message_id,
    messageThreadId: sentMessage.message_thread_id ?? null,
    fromUserId: botInfo.id,
    fromFirstName: botInfo.first_name,
    fromUsername: botInfo.username ?? null,
    fromIsBot: true,
    text: responseText,
    replyToMessageId: sentMessage.reply_to_message?.message_id ?? null,
    date: new Date(sentMessage.date * 1000),
    raw: sentMessage as unknown as Record<string, unknown>,
  };

  db.insert(telegramMessages)
    .values(row)
    .onConflictDoNothing()
    .catch((err: unknown) => {
      console.error("[message-logger] failed to persist bot message:", err);
    });
}

/**
 * Returns recent messages from a chat/topic within the given time window.
 */
export async function getRecentChatMessages(
  chatId: string,
  threadId: number | null,
  windowMs: number,
  limit: number,
  excludeMessageId?: number,
): Promise<(typeof telegramMessages.$inferSelect)[]> {
  const cutoff = new Date(Date.now() - windowMs);

  const conditions = [
    eq(telegramMessages.chatId, chatId),
    gte(telegramMessages.date, cutoff),
    ...(threadId !== null
      ? [eq(telegramMessages.messageThreadId, threadId)]
      : [isNull(telegramMessages.messageThreadId)]),
  ];

  const rows = await db
    .select()
    .from(telegramMessages)
    .where(and(...conditions))
    .orderBy(telegramMessages.date)
    .limit(limit + (excludeMessageId !== undefined ? 1 : 0));

  return excludeMessageId !== undefined
    ? rows.filter((r) => r.messageId !== excludeMessageId).slice(0, limit)
    : rows;
}
