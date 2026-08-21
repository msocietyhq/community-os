import { sql } from "drizzle-orm";
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
  uuid,
  real,
} from "drizzle-orm/pg-core";
import { vector } from "../types";

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

    // --- Semantic search ---
    embedding: vector("embedding", { dimensions: 512 }),

    /**
      * When extraction last considered this message — set even if no fact came
      * out of it, so the backfill can select unstamped rows and stay idempotent.
      */
    memoryExtractedAt: timestamp("memory_extracted_at"),
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
    // Drives the memory backfill's "what's left?" query over ~135k rows.
    index("telegram_messages_memory_pending_idx")
      .on(table.chatId, table.date)
      .where(sql`memory_extracted_at IS NULL`),
  ],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    model: text("model").notNull(),
    caller: text("caller").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }),
    chatId: text("chat_id"),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_usage_caller_idx").on(table.caller),
    index("ai_usage_created_at_idx").on(table.createdAt),
    index("ai_usage_telegram_user_idx").on(table.telegramUserId),
    index("ai_usage_model_idx").on(table.model),
  ],
);

export const botMemories = pgTable(
  "bot_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    content: text("content").notNull(),
    category: text("category").notNull(), // person_fact | community_preference | decision | technical | event_related | general
    subject: text("subject"),
    subjectTelegramId: bigint("subject_telegram_id", { mode: "number" }),
    sourceChatId: text("source_chat_id"),
    sourceMessageId: integer("source_message_id"),
    supersededBy: uuid("superseded_by"),
    supersededAt: timestamp("superseded_at"),
    confidence: real("confidence").notNull().default(0.8),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: timestamp("last_accessed_at"),
    embedding: vector("embedding", { dimensions: 512 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("bot_memories_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("bot_memories_subject_idx").on(table.subject),
    index("bot_memories_subject_telegram_id_idx").on(table.subjectTelegramId),
    index("bot_memories_category_idx").on(table.category),
    index("bot_memories_active_idx")
      .on(table.id)
      .where(sql`superseded_by IS NULL`),
    index("bot_memories_source_idx").on(table.sourceChatId, table.sourceMessageId),
  ],
);
