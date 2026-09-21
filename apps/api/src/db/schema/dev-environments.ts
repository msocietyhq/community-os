import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects } from "./projects";

export const devEnvironmentStatusEnum = pgEnum("dev_environment_status", [
  "active",
  "revoked",
  "expired",
]);

/**
 * A dev/agent working environment for a project (community-os itself is
 * just a row in `projects`, like any other endorsed project). Its env var
 * bundle lives in `dev_environment_vars` — a mix of values generated per
 * environment and values shared across the whole project.
 */
export const devEnvironments = pgTable("dev_environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  label: text("label"),
  status: devEnvironmentStatusEnum("status").default("active"),
  /**
   * Set only for CI-provisioned PR preview environments (issue #52). Used to
   * find-or-create idempotently on repeated `ci/ensure` calls for the same
   * PR (e.g. every push), instead of relying on `label`'s free-text shape.
   */
  prNumber: integer("pr_number"),
  /** Neon branch backing this environment's DATABASE_URL, so teardown can delete it. */
  neonBranchId: text("neon_branch_id"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  revokedBy: text("revoked_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * A project-wide secret (e.g. a shared staging AI provider key), created and
 * rotated once by a maintainer, then referenced — not copied — by every
 * environment in the project via `dev_environment_vars.shared_secret_id`.
 */
export const sharedSecrets = pgTable(
  "shared_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    description: text("description"),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdBy: text("created_by").references(() => user.id),
    rotatedAt: timestamp("rotated_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.key)],
);

/**
 * One env var in one environment's bundle. Exactly one of `sharedSecretId`
 * (a reference — most rows, auto-attached from the project's shared secrets
 * on environment creation) or `ciphertext`/`iv`/`authTag` (a value generated
 * just for this environment, e.g. a per-dev Neon branch's DATABASE_URL) is
 * set; enforced in the service layer, not a DB constraint.
 */
export const devEnvironmentVars = pgTable(
  "dev_environment_vars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => devEnvironments.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    sharedSecretId: uuid("shared_secret_id").references(
      () => sharedSecrets.id,
      { onDelete: "cascade" },
    ),
    ciphertext: text("ciphertext"),
    iv: text("iv"),
    authTag: text("auth_tag"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [unique().on(table.environmentId, table.key)],
);

/**
 * A short-lived bearer credential minted against one environment, so an
 * agent session (not a Better Auth user) can redeem that environment's env
 * var bundle without a human in the loop each time. Only the hash is
 * stored — the raw token is returned once, at mint time.
 */
export const devEnvironmentAgentKeys = pgTable("dev_environment_agent_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id")
    .notNull()
    .references(() => devEnvironments.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label"),
  issuedBy: text("issued_by")
    .notNull()
    .references(() => user.id),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
