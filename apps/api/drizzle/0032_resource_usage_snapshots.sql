CREATE TYPE "public"."usage_source" AS ENUM('neon');--> statement-breakpoint
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
ALTER TABLE "resource_usage_snapshots" ADD CONSTRAINT "resource_usage_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_usage_snapshots" ADD CONSTRAINT "resource_usage_snapshots_dev_environment_id_dev_environments_id_fk" FOREIGN KEY ("dev_environment_id") REFERENCES "public"."dev_environments"("id") ON DELETE set null ON UPDATE no action;