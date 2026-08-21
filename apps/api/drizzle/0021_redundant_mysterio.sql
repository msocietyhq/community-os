ALTER TABLE "telegram_messages" ADD COLUMN "memory_extracted_at" timestamp;--> statement-breakpoint
CREATE INDEX "telegram_messages_memory_pending_idx" ON "telegram_messages" USING btree ("chat_id","date") WHERE memory_extracted_at IS NULL;--> statement-breakpoint
-- Clear the memory corpus so the backfill rebuilds it under current rules.
--
-- These rows came from a prompt that recorded news links, commentary and
-- questions as facts and misattributed 86% of them. Every one came from a
-- message we still have, and the backfill is idempotent, so rebuilding beats
-- patching a half-old corpus. Recall is thin until it completes.
DELETE FROM bot_memories;
--> statement-breakpoint
-- Scope the rebuild to three years by marking older messages as considered.
--
-- History runs to 2016, but 56% predates 2021 and profile generation won't
-- treat year-old evidence as current anyway. Expressed as data, not a constant,
-- so widening the window later is an UPDATE rather than a code change.
UPDATE telegram_messages
SET memory_extracted_at = now()
WHERE date <= now() - interval '3 years';
