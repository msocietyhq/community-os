-- Migrate embedding column from 384 dimensions (HuggingFace) to 512 (Voyage AI voyage-3-lite)
-- The index must be dropped first, then recreated after the column type change.
DROP INDEX IF EXISTS "telegram_messages_embedding_idx";

-- Clear existing embeddings — they are incompatible with the new dimension.
-- The backfill script (src/db/backfill-embeddings.ts) must be re-run after deployment.
UPDATE "telegram_messages" SET "embedding" = NULL;

ALTER TABLE "telegram_messages"
  ALTER COLUMN "embedding" TYPE vector(512);

CREATE INDEX IF NOT EXISTS "telegram_messages_embedding_idx"
  ON "telegram_messages" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
