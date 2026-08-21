ALTER TABLE "members" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "ai_suggested" jsonb;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "ai_embedding" vector(512);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "ai_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "ai_dismissed" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- HNSW index for cosine search over the generated summary's embedding,
-- mirroring bot_memories_embedding_idx.
CREATE INDEX IF NOT EXISTS "members_ai_embedding_idx"
  ON "members"
  USING hnsw ("ai_embedding" vector_cosine_ops);
--> statement-breakpoint
-- Full-text index on the generated summary, mirroring bot_memories_fts_idx.
--
-- Deliberately NOT added to members_search_idx (the BM25 index backing the `q`
-- parameter on the public GET /api/v1/members route). Indexing ai_summary there
-- would make public search results depend on AI-derived text: searching
-- "cybersecurity" would start matching members whose generated summary mentions
-- it. The response body would not contain the summary, but membership in the
-- result set is itself inferred information. AI search gets its own index so
-- public search behaviour is unchanged.
CREATE INDEX IF NOT EXISTS "members_ai_summary_fts_idx"
  ON "members"
  USING GIN (to_tsvector('simple', coalesce("ai_summary", '')));
