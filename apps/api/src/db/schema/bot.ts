import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const botSession = pgTable("bot_session", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
