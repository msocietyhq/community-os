import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { devEnvironments } from "./dev-environments";

export const usageSourceEnum = pgEnum("usage_source", ["neon"]);

/**
 * A periodic pull of a provider's own consumption metrics (issue #52 follow-up:
 * "trace usage and cost"). One row per (environment, metric, period) — append-only,
 * never updated, so history is just "every row we've ever fetched." Foundation
 * only: this holds real numbers where a provider exposes them (Neon's per-branch
 * consumption API) and nothing where it doesn't (no Railway equivalent was found —
 * see ADR-010). No dollar amounts are computed; `metricName`/`value` are the
 * provider's own raw units (e.g. `compute_unit_seconds`, `root_branch_bytes_month`).
 */
export const resourceUsageSnapshots = pgTable("resource_usage_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Null once the environment itself is deleted (FK is ON DELETE SET NULL) — the snapshot still tells you what a since-removed PR cost. */
  devEnvironmentId: uuid("dev_environment_id").references(
    () => devEnvironments.id,
    { onDelete: "set null" },
  ),
  source: usageSourceEnum("source").notNull(),
  metricName: text("metric_name").notNull(),
  value: numeric("value", { precision: 20, scale: 4 }).notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
});
