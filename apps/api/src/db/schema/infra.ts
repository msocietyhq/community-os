import {
  pgTable,
  uuid,
  text,
  boolean,
  decimal,
  timestamp,
  jsonb,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects } from "./projects";

export const resourceStatusEnum = pgEnum("resource_status", [
  "provisioning",
  "active",
  "suspended",
  "deprovisioned",
]);

export const subdomainStatusEnum = pgEnum("subdomain_status", [
  "pending_dns",
  "active",
  "suspended",
  "deleted",
]);

export const infraServices = pgTable("infra_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  monthlyBudgetLimit: decimal("monthly_budget_limit", {
    precision: 10,
    scale: 2,
  }),
  apiBaseUrl: text("api_base_url"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const resourceTypes = pgTable(
  "resource_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    infraServiceId: uuid("infra_service_id")
      .notNull()
      .references(() => infraServices.id),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    defaultConfig: jsonb("default_config"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [unique().on(table.infraServiceId, table.name)]
);

export const provisionedResources = pgTable("provisioned_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  resourceTypeId: uuid("resource_type_id")
    .notNull()
    .references(() => resourceTypes.id),
  externalId: text("external_id"),
  externalName: text("external_name"),
  config: jsonb("config"),
  status: resourceStatusEnum("status").default("provisioning"),
  provisionedBy: text("provisioned_by").references(() => user.id),
  monthlyCostEstimate: decimal("monthly_cost_estimate", {
    precision: 10,
    scale: 2,
  }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deprovisionedAt: timestamp("deprovisioned_at"),
});

export const subdomains = pgTable("subdomains", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  provisionedResourceId: uuid("provisioned_resource_id").references(
    () => provisionedResources.id
  ),
  subdomain: text("subdomain").notNull().unique(),
  fullDomain: text("full_domain").notNull(),
  targetUrl: text("target_url").notNull(),
  dnsRecordId: text("dns_record_id"),
  status: subdomainStatusEnum("status").default("pending_dns"),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
