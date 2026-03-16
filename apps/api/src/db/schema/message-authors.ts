import { pgTable, text, bigint, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const messageAuthors = pgTable(
  "message_authors",
  {
    chatId: text("chat_id").notNull(),
    messageId: text("message_id").notNull(),
    fromUserId: bigint("from_user_id", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.messageId] })],
);
