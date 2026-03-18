-- Custom SQL migration file, put your code below! --
-- Run AFTER the backfill script (src/db/backfill-embeddings.ts) has populated
-- the embedding column, otherwise ivfflat cannot build the required clusters.
CREATE INDEX IF NOT EXISTS "telegram_messages_embedding_idx"
  ON "telegram_messages" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
