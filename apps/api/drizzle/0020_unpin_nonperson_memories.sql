-- Custom SQL migration file, put your code below! --

-- Un-pin memories whose subject is not a person.
--
-- memory-extractor.ts fell back to the sending user when it couldn't resolve a
-- fact's subject, misattributing 956 of 1117 active memories (86%) — a shared
-- news link became a fact about the sharer. Those fed AI profile generation.
--
-- The fallback is gone; this corrects the rows it already wrote, keeping only
-- exact name/username matches and unambiguous first names. Nulling clears the
-- attribution only: content, embedding and source pointer are untouched, so the
-- memory stays searchable.

UPDATE bot_memories bm
SET subject_telegram_id = NULL
WHERE bm.subject_telegram_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user" u
    WHERE u.telegram_id IS NOT NULL
      AND (
        lower(u.name) = lower(regexp_replace(trim(bm.subject), '^@', ''))
        OR lower(u.telegram_username) = lower(regexp_replace(trim(bm.subject), '^@', ''))
      )
  )
  AND NOT (
    -- Unambiguous only: two members called "Ali" means a wrong guess writes
    -- a fact onto the wrong person's profile.
    SELECT count(*) = 1
    FROM "user" u
    WHERE u.telegram_id IS NOT NULL
      AND lower(split_part(u.name, ' ', 1)) =
          lower(regexp_replace(trim(bm.subject), '^@', ''))
  );
