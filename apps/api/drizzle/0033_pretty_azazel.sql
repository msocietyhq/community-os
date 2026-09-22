DROP TABLE "project_infra_configs" CASCADE;--> statement-breakpoint
DROP TABLE "resource_usage_snapshots" CASCADE;--> statement-breakpoint
ALTER TABLE "dev_environments" DROP COLUMN "pr_number";--> statement-breakpoint
ALTER TABLE "dev_environments" DROP COLUMN "neon_branch_id";--> statement-breakpoint
ALTER TABLE "dev_environments" DROP COLUMN "railway_environment_id";--> statement-breakpoint
DROP TYPE "public"."usage_source";--> statement-breakpoint
-- Cleanup: the fallback owner seeded for CI-provisioned PR preview
-- environments (migration 0032) has no purpose now that PR previews are
-- removed entirely (see ADR-012). Cascades to any dev_environments row
-- still owned by it.
DELETE FROM "user" WHERE "id" = 'system-bootstrap';