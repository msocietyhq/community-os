import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects } from "./projects";

/**
 * Where a project's PR preview environments get provisioned — identifiers
 * only, never credentials (the Neon/Railway API keys that use them stay as
 * this API's own env vars, per ADR-006/007/009). One row per project.
 *
 * Once `neonProjectId` and the three `railway*` fields are all set, PR
 * previews are fully automatic: this API creates/deletes the Neon branch
 * *and* the Railway environment, and sets its variables directly via
 * Railway's API — no per-PR credential ever touches Railway's dashboard
 * (see ADR-009, which replaced the project-bootstrap-token/preflight
 * design ADR-008 shipped with).
 */
export const projectInfraConfigs = pgTable("project_infra_configs", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  neonProjectId: text("neon_project_id"),
  railwayProjectId: text("railway_project_id"),
  /** The service (within `railwayProjectId`) that PR preview environments deploy. */
  railwayServiceId: text("railway_service_id"),
  /** The environment a new PR environment clones its config from (usually production). */
  railwaySourceEnvironmentId: text("railway_source_environment_id"),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
