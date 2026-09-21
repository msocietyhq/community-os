import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects } from "./projects";

/**
 * Where a project's PR preview environments get provisioned — identifiers
 * only, never credentials (the Neon/Railway API keys that use them stay as
 * this API's own env vars, per ADR-006/007). One row per project.
 */
export const projectInfraConfigs = pgTable("project_infra_configs", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  neonProjectId: text("neon_project_id"),
  railwayProjectId: text("railway_project_id"),
  railwayServiceId: text("railway_service_id"),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * A project-scoped bootstrap credential, distinct from
 * `dev_environment_agent_keys` (environment-scoped, short-lived, minted
 * per-session). This one is long-lived and maintainer-rotatable: it's the
 * single value a project's Railway service clones into every PR environment
 * at fork time, before that environment exists in our DB. See issue #52 /
 * ADR-008 for the "same value cloned into every open PR" residual-risk note.
 */
export const projectBootstrapTokens = pgTable("project_bootstrap_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
