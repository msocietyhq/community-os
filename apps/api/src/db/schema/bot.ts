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
  customType,
  uuid,
  real,
} from "drizzle-orm/pg-core";

const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 512})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

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
