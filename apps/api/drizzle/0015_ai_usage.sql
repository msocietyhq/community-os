-- Custom SQL migration file, put your code below! --
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"caller" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"telegram_user_id" bigint,
	"chat_id" text,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_usage_caller_idx" ON "ai_usage" ("caller");
--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage" ("created_at");
--> statement-breakpoint
CREATE INDEX "ai_usage_telegram_user_idx" ON "ai_usage" ("telegram_user_id");
--> statement-breakpoint
CREATE INDEX "ai_usage_model_idx" ON "ai_usage" ("model");
