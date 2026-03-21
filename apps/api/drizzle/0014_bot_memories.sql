-- Custom SQL migration file, put your code below! --
CREATE TABLE "bot_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"category" text NOT NULL,
	"subject" text,
	"subject_telegram_id" bigint,
	"source_chat_id" text,
	"source_message_id" integer,
	"superseded_by" uuid,
	"superseded_at" timestamp,
	"confidence" real DEFAULT 0.8 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp,
	"embedding" vector(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_memories_embedding_idx" ON "bot_memories" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "bot_memories_subject_idx" ON "bot_memories" ("subject");
--> statement-breakpoint
CREATE INDEX "bot_memories_subject_telegram_id_idx" ON "bot_memories" ("subject_telegram_id");
--> statement-breakpoint
CREATE INDEX "bot_memories_category_idx" ON "bot_memories" ("category");
--> statement-breakpoint
CREATE INDEX "bot_memories_active_idx" ON "bot_memories" ("id") WHERE superseded_by IS NULL;
--> statement-breakpoint
CREATE INDEX "bot_memories_source_idx" ON "bot_memories" ("source_chat_id","source_message_id");
