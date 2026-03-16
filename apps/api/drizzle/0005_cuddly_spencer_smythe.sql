CREATE TABLE "message_authors" (
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"from_user_id" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_authors_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "reputation_triggers" ADD CONSTRAINT "uq_trigger_type_value" UNIQUE("trigger_type","trigger_value");