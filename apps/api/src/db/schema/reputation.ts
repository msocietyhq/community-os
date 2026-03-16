import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const reputationTriggerTypeEnum = pgEnum("reputation_trigger_type", [
  "reaction",
  "keyword",
]);

export const reputationTriggers = pgTable(
  "reputation_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triggerType: reputationTriggerTypeEnum("trigger_type").notNull(),
    triggerValue: text("trigger_value").notNull(),
    reputationValue: integer("reputation_value").notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("uq_trigger_type_value").on(table.triggerType, table.triggerValue),
  ],
);

export const reputationEvents = pgTable(
  "reputation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    triggerId: uuid("trigger_id").references(() => reputationTriggers.id),
    value: integer("value").notNull(),
    telegramMessageId: text("telegram_message_id"),
    telegramChatId: text("telegram_chat_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    unique().on(table.fromUserId, table.toUserId, table.telegramMessageId),
  ]
);
