CREATE TYPE "public"."dev_environment_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
ALTER TYPE "public"."project_member_role" ADD VALUE 'maintainer' BEFORE 'contributor';--> statement-breakpoint
CREATE TABLE "dev_environment_agent_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"issued_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "dev_environment_agent_keys_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "dev_environment_vars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"key" text NOT NULL,
	"shared_secret_id" uuid,
	"ciphertext" text,
	"iv" text,
	"auth_tag" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "dev_environment_vars_environment_id_key_unique" UNIQUE("environment_id","key")
);
--> statement-breakpoint
CREATE TABLE "dev_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"label" text,
	"status" "dev_environment_status" DEFAULT 'active',
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shared_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"created_by" text,
	"rotated_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "shared_secrets_project_id_key_unique" UNIQUE("project_id","key")
);
--> statement-breakpoint
ALTER TABLE "dev_environment_agent_keys" ADD CONSTRAINT "dev_environment_agent_keys_environment_id_dev_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."dev_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_environment_agent_keys" ADD CONSTRAINT "dev_environment_agent_keys_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_environment_vars" ADD CONSTRAINT "dev_environment_vars_environment_id_dev_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."dev_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_environment_vars" ADD CONSTRAINT "dev_environment_vars_shared_secret_id_shared_secrets_id_fk" FOREIGN KEY ("shared_secret_id") REFERENCES "public"."shared_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_environments" ADD CONSTRAINT "dev_environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_environments" ADD CONSTRAINT "dev_environments_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_environments" ADD CONSTRAINT "dev_environments_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_secrets" ADD CONSTRAINT "shared_secrets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_secrets" ADD CONSTRAINT "shared_secrets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;