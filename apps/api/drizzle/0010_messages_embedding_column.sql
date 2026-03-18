-- Custom SQL migration file, put your code below! --
ALTER TABLE "telegram_messages"
  ADD COLUMN IF NOT EXISTS "embedding" vector(384);
