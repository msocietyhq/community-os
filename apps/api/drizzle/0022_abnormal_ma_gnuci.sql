ALTER TABLE "members" ADD COLUMN "welcomed_at" timestamp;--> statement-breakpoint
-- Treat every member that already exists as already greeted. Without this the
-- new welcome paths read NULL as "never welcomed" and would greet the entire
-- existing community the first time each of them is seen after deploy.
UPDATE "members" SET "welcomed_at" = COALESCE("joined_at", "created_at", now()) WHERE "welcomed_at" IS NULL;
