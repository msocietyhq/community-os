import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-provider credit state.
 *
 * A table rather than the module-level Map every other cooldown in this
 * codebase uses. Those can afford to lose their state on deploy; this one
 * cannot. `notified_at` is what stops a multi-day outage from re-DMing every
 * admin after each Railway deploy, and that guarantee is the whole point.
 * A shared table also keeps replicas in agreement.
 *
 * A provider with no row reads as healthy, so no backfill is needed.
 */
export const providerHealth = pgTable("provider_health", {
  /** An AiProvider value: "anthropic" | "openai" | "deepseek". */
  provider: text("provider").primaryKey(),
  /** "healthy" | "out_of_credit". */
  state: text("state").notNull().default("healthy"),
  downSince: timestamp("down_since"),
  /** Earliest next probe. Past this instant, resolution stops substituting. */
  retryAfter: timestamp("retry_after"),
  /** Drives the backoff curve. Reset to 0 on recovery. */
  failureCount: integer("failure_count").notNull().default(0),
  /** Set when the outage DM goes out; the once-per-outage guard. */
  notifiedAt: timestamp("notified_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
