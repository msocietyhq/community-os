import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value").notNull(),
  performedBy: text("performed_by").references(() => user.id),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});
