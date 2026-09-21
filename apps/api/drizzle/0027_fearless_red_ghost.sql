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
ALTER TABLE "resource_secrets" ADD CONSTRAINT "resource_secrets_provisioned_resource_id_provisioned_resources_id_fk" FOREIGN KEY ("provisioned_resource_id") REFERENCES "public"."provisioned_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_secrets" ADD CONSTRAINT "resource_secrets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_secrets" ADD CONSTRAINT "resource_secrets_last_revealed_by_user_id_fk" FOREIGN KEY ("last_revealed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;