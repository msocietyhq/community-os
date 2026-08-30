CREATE TABLE "provider_health" (
	"provider" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'healthy' NOT NULL,
	"down_since" timestamp,
	"retry_after" timestamp,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"notified_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
