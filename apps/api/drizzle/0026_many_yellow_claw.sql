CREATE TYPE "public"."dataset_category" AS ENUM('religious_infrastructure', 'community_data', 'educational', 'health_wellness', 'business_economy', 'other');--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"link" text NOT NULL,
	"category" "dataset_category" NOT NULL,
	"formats" text[] NOT NULL,
	"license" text,
	"coverage" text,
	"last_updated" timestamp,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"repo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
