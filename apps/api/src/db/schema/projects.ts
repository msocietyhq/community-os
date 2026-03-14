import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const projectNatureEnum = pgEnum("project_nature", [
  "startup",
  "community",
  "side_project",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "paused",
  "archived",
]);

export const projectMemberRoleEnum = pgEnum("project_member_role", [
  "owner",
  "contributor",
]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  nature: projectNatureEnum("nature").notNull(),
  platforms: text("platforms").array(),
  status: projectStatusEnum("status").default("active"),
  url: text("url"),
  repoUrl: text("repo_url"),
  thumbnailUrl: text("thumbnail_url"),
  isEndorsed: boolean("is_endorsed").default(false),
  endorsedAt: timestamp("endorsed_at"),
  endorsedBy: text("endorsed_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: projectMemberRoleEnum("role").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.userId)]
);
