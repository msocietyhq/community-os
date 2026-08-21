-- Custom SQL migration file, put your code below! --

-- Full-text index on memory content, mirroring telegram_messages_fts_idx.
--
-- Embeddings blur exact tokens: ~20% of memories contain a domain, acronym or
-- CamelCase product name (ppm.techforpalestine.org, GovTech, PlayTours) that a
-- cosine search smears into a neighbourhood. Measured case: the memory
-- "Someone in the chat works at Stripe" scored only 0.533 against "who works at
-- a fintech company?" — an exact-token search finds it outright.
CREATE INDEX IF NOT EXISTS "bot_memories_fts_idx"
  ON "bot_memories"
  USING GIN (to_tsvector('simple', coalesce("content", '')));
