-- Simplify reputation: drop events table, compute scores from telegram_messages

-- 1. Drop tables no longer needed
DROP TABLE IF EXISTS reputation_events;
DROP TABLE IF EXISTS message_authors;

-- 2. Delete reaction triggers
DELETE FROM reputation_triggers WHERE trigger_type = 'reaction';

-- 3. Replace enum without "reaction"
ALTER TYPE reputation_trigger_type RENAME TO reputation_trigger_type_old;
CREATE TYPE reputation_trigger_type AS ENUM ('keyword');
ALTER TABLE reputation_triggers
  ALTER COLUMN trigger_type TYPE reputation_trigger_type
  USING trigger_type::text::reputation_trigger_type;
DROP TYPE reputation_trigger_type_old;

-- 4. Add materialized score column to members
ALTER TABLE members ADD COLUMN reputation_score integer NOT NULL DEFAULT 0;