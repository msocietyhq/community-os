import {
  pgTable,
  uuid,
  text,
  decimal,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { eventPledges } from "./events";

export const fundTransactionTypeEnum = pgEnum("fund_transaction_type", [
  "expense",
  "reimbursement",
  "pledge_collection",
  "adjustment",
]);

export const spendCategories = pgTable("spend_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const fundTransactions = pgTable("fund_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: fundTransactionTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").default("SGD"),
  description: text("description").notNull(),
  categoryId: uuid("category_id").references(() => spendCategories.id),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  pledgeId: uuid("pledge_id").references(() => eventPledges.id),
  paidBy: text("paid_by").references(() => user.id),
  receivedBy: text("received_by").references(() => user.id),
  recordedBy: text("recorded_by")
    .notNull()
    .references(() => user.id),
  receiptUrl: text("receipt_url"),
  occurredAt: timestamp("occurred_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
