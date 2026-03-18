import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  bigint,
  boolean,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

export const botSession = pgTable("bot_session", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const telegramMessages = pgTable(
  "telegram_messages",
  {
    // --- Identity / routing ---
    chatId: text("chat_id").notNull(),
    chatType: text("chat_type").notNull(), // 'private'|'group'|'supergroup'|'channel'
    messageId: integer("message_id").notNull(), // Telegram message ID (unique within chatId)
    messageThreadId: integer("message_thread_id"), // forum topic ID (null in non-forum chats)
    isTopicMessage: boolean("is_topic_message"),
    isAutomaticForward: boolean("is_automatic_forward"),

    // --- Sender ---
    fromUserId: bigint("from_user_id", { mode: "number" }),
    fromFirstName: text("from_first_name"),
    fromLastName: text("from_last_name"),
    fromUsername: text("from_username"),
    fromIsBot: boolean("from_is_bot").default(false),
    fromIsPremium: boolean("from_is_premium"),
    fromLanguageCode: text("from_language_code"),

    // --- Sender chat (when posted on behalf of a channel/chat) ---
    senderChatId: bigint("sender_chat_id", { mode: "number" }),
    senderChatUsername: text("sender_chat_username"),
    senderChatTitle: text("sender_chat_title"),
    authorSignature: text("author_signature"),

    // --- Content ---
    text: text("text"),
    caption: text("caption"),
    mediaType: text("media_type"), // 'photo'|'video'|'audio'|'document'|'sticker'|'voice'|'animation'|'video_note'|'location'|'poll'|'contact'|'dice'|'game'|'story'|'paid_media'
    entities: jsonb("entities"), // MessageEntity[]
    captionEntities: jsonb("caption_entities"), // MessageEntity[] for captions

    // --- Reply chain ---
    replyToMessageId: integer("reply_to_message_id"),
    externalReplyChatId: text("external_reply_chat_id"),

    // --- Forward origin ---
    forwardOriginType: text("forward_origin_type"), // 'user'|'hidden_user'|'chat'|'channel'
    forwardFromUserId: bigint("forward_from_user_id", { mode: "number" }),
    forwardFromFirstName: text("forward_from_first_name"),
    forwardFromUsername: text("forward_from_username"),
    forwardFromChatId: bigint("forward_from_chat_id", { mode: "number" }),
    forwardFromChatTitle: text("forward_from_chat_title"),
    forwardDate: timestamp("forward_date"),

    // --- Bot context ---
    viaBotId: bigint("via_bot_id", { mode: "number" }),
    businessConnectionId: text("business_connection_id"),

    // --- Poll (when mediaType = 'poll') ---
    pollId: text("poll_id"),
    pollQuestion: text("poll_question"),

    // --- Edit tracking ---
    editDate: timestamp("edit_date"),

    // --- Service messages ---
    newChatMemberIds: jsonb("new_chat_member_ids"), // number[]
    leftChatMemberUserId: bigint("left_chat_member_user_id", { mode: "number" }),
    newChatTitle: text("new_chat_title"),
    pinnedMessageId: integer("pinned_message_id"),

    // --- Timing ---
    date: timestamp("date").notNull(), // from Telegram Unix seconds
    createdAt: timestamp("created_at").defaultNow().notNull(),

    // --- Full message (future-proof) ---
    raw: jsonb("raw").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.messageId] }),
    index("telegram_messages_chat_date_idx").on(table.chatId, table.date),
    index("telegram_messages_chat_thread_date_idx").on(
      table.chatId,
      table.messageThreadId,
      table.date,
    ),
    index("telegram_messages_from_user_idx").on(table.fromUserId),
    index("telegram_messages_chat_type_idx").on(table.chatType),
  ],
);
