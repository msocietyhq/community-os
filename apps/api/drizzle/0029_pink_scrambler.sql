CREATE TABLE "telegram_topics" (
	"chat_id" text NOT NULL,
	"thread_id" integer NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_topics_chat_id_thread_id_pk" PRIMARY KEY("chat_id","thread_id")
);
