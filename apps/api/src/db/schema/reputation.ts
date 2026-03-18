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

export const reputationTriggerTypeEnum = pgEnum("reputation_trigger_type", [
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
