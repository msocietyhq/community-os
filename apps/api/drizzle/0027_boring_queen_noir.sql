CREATE TYPE "public"."fund_cause_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TABLE "resource_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provisioned_resource_id" uuid NOT NULL,
	"key" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"created_by" text,
	"rotated_at" timestamp,
	"last_revealed_at" timestamp,
	"last_revealed_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "resource_secrets_provisioned_resource_id_key_unique" UNIQUE("provisioned_resource_id","key")
);
--> statement-breakpoint
CREATE TABLE "fund_causes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"target_amount" numeric(10, 2),
	"status" "fund_cause_status" DEFAULT 'active',
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "fund_causes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "resource_secrets" ADD CONSTRAINT "resource_secrets_provisioned_resource_id_provisioned_resources_id_fk" FOREIGN KEY ("provisioned_resource_id") REFERENCES "public"."provisioned_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_secrets" ADD CONSTRAINT "resource_secrets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_secrets" ADD CONSTRAINT "resource_secrets_last_revealed_by_user_id_fk" FOREIGN KEY ("last_revealed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_causes" ADD CONSTRAINT "fund_causes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;