ALTER TABLE "telegram_messages" ADD COLUMN "memory_extracted_at" timestamp;--> statement-breakpoint
CREATE INDEX "telegram_messages_memory_pending_idx" ON "telegram_messages" USING btree ("chat_id","date") WHERE memory_extracted_at IS NULL;--> statement-breakpoint
-- Clear the memory corpus so the backfill rebuilds it under the current rules.
--
-- The 1117 rows here were produced by a prompt that recorded shared news links,
-- industry commentary and questions as facts, and pinned 86% of them to whoever
-- was speaking rather than who they were about. Measured against the current
-- extractor, 82% of those messages should have produced nothing at all.
--
-- Rebuilding beats patching: every row came from a message we still have, the
-- backfill is idempotent, and a corpus half-old half-new is harder to reason
-- about than one built entirely under known rules.
--
-- Leaves memory_extracted_at NULL on every message, so the boot backfill treats
-- the whole history as pending and works through it. Recall is thin until that
-- completes — a bounded cost for a corpus that is currently mostly noise.
DELETE FROM bot_memories;
--> statement-breakpoint
-- Scope the rebuild to the last three years by marking everything older as
-- already considered.
--
-- The corpus runs back to 2016, but 56% of it predates 2021 and profile
-- generation already refuses to treat evidence older than a year as current —
-- a 2018 memory about someone's employer can only ever surface as "worked on X
-- in 2018". Three years covers everyone currently active for ~$3.60 and about
-- an hour, against $22 and five hours for the full decade.
--
-- Expressed as data rather than a constant in the service: the backfill simply
-- drains unstamped messages, so widening the window later is
--   UPDATE telegram_messages SET memory_extracted_at = NULL WHERE date > ...
-- with no code change, and "nothing pending" stays truthful in the meantime.
UPDATE telegram_messages
SET memory_extracted_at = now()
WHERE date <= now() - interval '3 years';
