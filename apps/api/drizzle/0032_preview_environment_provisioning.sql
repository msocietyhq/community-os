CREATE TYPE "public"."usage_source" AS ENUM('neon');--> statement-breakpoint
CREATE TABLE "project_infra_configs" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"neon_project_id" text,
	"railway_project_id" text,
	"railway_service_id" text,
	"railway_source_environment_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "resource_usage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"dev_environment_id" uuid,
	"source" "usage_source" NOT NULL,
	"metric_name" text NOT NULL,
	"value" numeric(20, 4) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"fetched_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "dev_environments" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "dev_environments" ADD COLUMN "neon_branch_id" text;--> statement-breakpoint
ALTER TABLE "dev_environments" ADD COLUMN "railway_environment_id" text;--> statement-breakpoint
ALTER TABLE "project_infra_configs" ADD CONSTRAINT "project_infra_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_infra_configs" ADD CONSTRAINT "project_infra_configs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_usage_snapshots" ADD CONSTRAINT "resource_usage_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_usage_snapshots" ADD CONSTRAINT "resource_usage_snapshots_dev_environment_id_dev_environments_id_fk" FOREIGN KEY ("dev_environment_id") REFERENCES "public"."dev_environments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Fallback owner for CI-provisioned PR preview environments whose PR author
-- isn't a known community-os member (e.g. an external contributor). See
-- SYSTEM_USER_ID in apps/api/src/services/dev-environments.service.ts and
-- ADR-009. dev_environments.owner_id is NOT NULL and FKs to user.id, so this
-- row exists rather than making ownership nullable everywhere it's read.
INSERT INTO "user" ("id", "name", "email", "email_verified", "role")
VALUES ('system-bootstrap', 'community-os bot', NULL, false, 'member')
ON CONFLICT ("id") DO NOTHING;