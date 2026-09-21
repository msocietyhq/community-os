import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const datasetCategoryEnum = pgEnum("dataset_category", [
  "religious_infrastructure",
  "community_data",
  "educational",
  "health_wellness",
  "business_economy",
  "other",
]);

export const datasets = pgTable("datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  source: text("source").notNull(),
  link: text("link").notNull(),
  category: datasetCategoryEnum("category").notNull(),
  formats: text("formats").array().notNull(),
  license: text("license"),
  coverage: text("coverage"),
  lastUpdated: timestamp("last_updated"),
  tags: text("tags").array().notNull().default([]),
  repoUrl: text("repo_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Dataset = typeof datasets.$inferSelect;
export type NewDataset = typeof datasets.$inferInsert;
