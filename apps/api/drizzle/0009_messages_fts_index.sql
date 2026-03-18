-- Custom SQL migration file, put your code below! --
CREATE INDEX IF NOT EXISTS "telegram_messages_fts_idx"
  ON "telegram_messages"
  USING GIN (
    to_tsvector('simple', coalesce("text", '') || ' ' || coalesce("caption", ''))
  );
